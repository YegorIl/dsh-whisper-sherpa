import { spawn } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { EventEmitter } from 'node:events'
import { Worker } from 'node:worker_threads'

/** @typedef {{ phase: string, [key: string]: unknown }} PreparationState */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'whisper-local'
/** The speech registry this provider contributes to. */
export const inject = ['speechToText']

const MODEL_SIZES = ['tiny', 'base', 'small', 'medium']
const MODEL_ORIGIN = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'
// ASCII-only user-facing copy: this package is edited on Windows hosts whose
// shell writes ANSI, and a single re-encode used to turn Russian labels into
// mojibake in the provider picker.
const DISCIPLINE = 'dsh-whisper-local'

/**
 * Local Whisper provider for the DSH speech registry.
 *
 * The plugin owns one worker thread that runs the sherpa-onnx Whisper
 * recognizer, so decoding never blocks the Host. Models live under `dataRoot`
 * and are downloaded on the first explicit preparation.
 * @param ctx - Host context with the `speechToText` service.
 * @param config - deployment configuration from the bundle patch.
 */
export function apply(ctx, config) {
  const dataRoot = String(config.dataRoot ?? '')
  if (dataRoot === '' || !isAbsolute(dataRoot)) {
    throw new Error(`${DISCIPLINE}: dataRoot must be an absolute path, got ${JSON.stringify(dataRoot)}`)
  }
  const model = MODEL_SIZES.includes(config.model) ? config.model : 'small'
  const providerId = String(config.providerId ?? 'whisper-local')
  const threads = Number.isInteger(config.threads) && config.threads > 0 ? config.threads : 4
  const maxAudioBytes = Number.isInteger(config.maxAudioBytes) ? config.maxAudioBytes : 8 * 1024 * 1024
  const modelDir = join(dataRoot, `sherpa-onnx-whisper-${model}`)

  const preparation = createPreparation(ctx, { dataRoot, model, modelDir })
  const state = { worker: undefined, pending: new Map(), nextId: 0, disposed: false }

  ctx.effect(() => {
    const dispose = ctx.speechToText.register({
      info: {
        id: providerId,
        name: `Whisper ${model} (local)`,
        location: 'host-local',
        languages: ['auto', 'ru', 'en', 'de', 'es', 'fr', 'pt', 'zh', 'ja', 'ko'],
        setupEstimate: {
          recommendedDiskBytes: model === 'tiny' ? 130 * 1024 ** 2 : model === 'base' ? 220 * 1024 ** 2 : 700 * 1024 ** 2,
          expectedMemoryBytes: model === 'tiny' ? 200 * 1024 ** 2 : model === 'base' ? 350 * 1024 ** 2 : 1100 * 1024 ** 2,
          minimumMinutes: 1,
          maximumMinutes: 20,
        },
      },
      preparation,
      transcribe: async (input, signal) => await transcribe(input, signal),
    })
    void preparation.inspect()
    ctx.logger?.info?.(
      `${DISCIPLINE}: provider ${providerId} registered (model ${model}, directory ${modelDir})`,
    )
    return async () => {
      state.disposed = true
      stopWorker(state)
      await preparation.cancel()
      await dispose()
    }
  })

  async function transcribe(input, signal) {
    if (!preparation.ready()) {
      throw new Error('The local Whisper model is not ready: open the voice plugin settings and run preparation')
    }
    const audio = input.audio
    if (audio === undefined || audio.byteLength === 0) throw new Error('Empty recording')
    if (audio.byteLength > maxAudioBytes) throw new Error('Recording exceeds the audio byte limit')
    const language = preparation.language(input.language)
    signal?.throwIfAborted()

    const worker = ensureWorker(state, ctx)
    const id = state.nextId += 1
    const result = new Promise((resolve, reject) => {
      const onAbort = () => {
        state.pending.delete(id)
        // Decoding cannot be interrupted from outside: the worker is terminated
        // and the next call starts a fresh one, reloading the model.
        stopWorker(state)
        reject(signal.reason instanceof Error ? signal.reason : new Error('Cancelled'))
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true })
      state.pending.set(id, {
        resolve: (value) => { if (signal) signal.removeEventListener('abort', onAbort); resolve(value) },
        reject: (error) => { if (signal) signal.removeEventListener('abort', onAbort); reject(error) },
      })
    })
    worker.postMessage({
      id,
      wav: audio instanceof Uint8Array ? audio : new Uint8Array(audio),
      modelDir,
      language,
      threads,
    })
    const reply = await result
    signal?.throwIfAborted()
    return { text: reply.text, audioSeconds: reply.audioSeconds, inferenceSeconds: reply.inferenceSeconds }
  }
}

/** One reusable worker thread plus request bookkeeping. */
function ensureWorker(state, ctx) {
  if (state.worker !== undefined) return state.worker
  const worker = new Worker(new URL('./worker.cjs', import.meta.url))
  const failAll = (error) => {
    for (const [, entry] of state.pending) entry.reject(error)
    state.pending.clear()
  }
  worker.on('message', (message) => {
    const entry = state.pending.get(message.id)
    if (entry === undefined) return
    state.pending.delete(message.id)
    if (message.ok) entry.resolve(message)
    else entry.reject(new Error(message.error))
  })
  worker.on('error', (error) => {
    failAll(error instanceof Error ? error : new Error(String(error)))
  })
  worker.on('exit', (code) => {
    if (state.worker === worker) state.worker = undefined
    if (state.disposed) return
    failAll(new Error(`Speech worker exited with code ${code}`))
  })
  worker.unref()
  state.worker = worker
  ctx.logger?.info?.(`${DISCIPLINE}: speech worker started`)
  return worker
}

/** Release the worker thread; in-flight requests are the caller's problem. */
function stopWorker(state) {
  const worker = state.worker
  state.worker = undefined
  if (worker !== undefined) void worker.terminate()
}

/** Model download, extraction and readiness reporting. */
function createPreparation(ctx, { dataRoot, model, modelDir }) {
  const events = new EventEmitter()
  /** @type {PreparationState} */
  let current = { phase: 'unprepared' }
  let task
  let controller

  const publish = (next) => {
    current = next
    events.emit('change')
  }

  const files = () => {
    try {
      if (!existsSync(modelDir)) return undefined
      const names = readdirSync(modelDir)
      const has = (suffix) => names.some((name) => name.endsWith(suffix))
      if (!has('tokens.txt')) return undefined
      if (!has('-encoder.onnx') && !has('-encoder.int8.onnx')) return undefined
      if (!has('-decoder.onnx') && !has('-decoder.int8.onnx')) return undefined
      return names
    } catch {
      return undefined
    }
  }

  return {
    /** Inspect the model directory without downloading anything. */
    async inspect() {
      publish(files() === undefined ? { phase: 'unprepared' } : { phase: 'ready', step: 'load' })
      return current
    },
    ready() {
      return files() !== undefined
    },
    language(code) {
      return typeof code === 'string' && code !== '' ? code : 'ru'
    },
    snapshot() {
      // The model may appear after inspect(); refresh readiness without an
      // explicit prepare() call.
      if ((current.phase === 'unprepared' || current.phase === 'cancelled') && files() !== undefined) {
        current = { phase: 'ready', step: 'load' }
      }
      return current
    },
    subscribe(listener) {
      events.on('change', listener)
      return () => events.off('change', listener)
    },
    prepare() {
      if (files() !== undefined) {
        publish({ phase: 'ready', step: 'load' })
        return
      }
      if (task !== undefined) return
      controller = new AbortController()
      task = runDownload(controller.signal).finally(() => {
        task = undefined
        controller = undefined
      })
      void task.catch(() => undefined)
    },
    async cancel() {
      controller?.abort(new Error('Preparation cancelled'))
      await task?.catch(() => undefined)
    },
  }

  async function runDownload(signal) {
    const archive = join(dataRoot, `${model}.tar.bz2`)
    const url = `${MODEL_ORIGIN}/sherpa-onnx-whisper-${model}.tar.bz2`
    try {
      await mkdir(dataRoot, { recursive: true })
      publish({ phase: 'checking', startedAt: Date.now(), step: 'check' })
      ctx.logger?.info?.(`${DISCIPLINE}: downloading ${url}`)
      const response = await fetch(url, { signal, redirect: 'follow' })
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`)
      const totalBytes = Number(response.headers.get('content-length') ?? 0) || undefined
      const out = createWriteStream(archive)
      let completedBytes = 0
      let lastPublish = 0
      try {
        for await (const chunk of response.body) {
          completedBytes += chunk.length
          if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve))
          const now = Date.now()
          if (now - lastPublish > 200) {
            lastPublish = now
            publish({ phase: 'downloading', resource: `whisper-${model}`, completedBytes, totalBytes, step: 'model' })
          }
        }
      } finally {
        await new Promise((resolve) => out.end(resolve))
      }
      publish({ phase: 'loading', startedAt: Date.now(), step: 'load' })
      await extract(archive, dataRoot)
      await rm(archive, { force: true })
      if (files() === undefined) throw new Error(`model files are missing after extraction in ${modelDir}`)
      publish({ phase: 'ready', step: 'load' })
      ctx.logger?.info?.(`${DISCIPLINE}: model ready`)
    } catch (error) {
      if (signal.aborted) {
        publish({ phase: 'cancelled' })
        return
      }
      const message = error instanceof Error ? error.message : String(error)
      publish({ phase: 'failed', message })
      ctx.logger?.warn?.(`${DISCIPLINE}: preparation failed: ${message}`)
      throw error
    }
  }
}

/** Unpack the release tarball with the system tar (bsdtar handles bz2). */
function extract(archive, destination) {
  return new Promise((resolve, reject) => {
    const child = spawn('tar.exe', ['-xjf', archive, '-C', destination], { windowsHide: true })
    let stderr = ''
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => reject(new Error(`tar.exe is unavailable: ${error.message}`)))
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar.exe exited with code ${code}: ${stderr.trim()}`))
    })
  })
}
