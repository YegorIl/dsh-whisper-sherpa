'use strict'
/**
 * Inference worker for the local Whisper provider.
 *
 * Runs sherpa-onnx OfflineRecognizer with a Whisper ONNX model in a worker
 * thread, so a long decode never blocks the DSH host event loop.
 * Protocol: { id, wav: Uint8Array, language } -> { id, ok, text?, audioSeconds?, inferenceSeconds?, error? }
 */
const { parentPort } = require('node:worker_threads')
const path = require('node:path')
const fs = require('node:fs')

const sherpa = require('../vendor/sherpa-onnx.js')

let recognizer = null
let loaded = ''

/** Find the encoder/decoder pair of a sherpa-onnx Whisper directory. */
function modelFiles(dir) {
  const files = fs.readdirSync(dir)
  const pick = (suffix) => {
    const hit = files.find((name) => name.endsWith(suffix))
    if (hit === undefined) throw new Error(`в каталоге модели нет файла *${suffix}: ${dir}`)
    return path.join(dir, hit)
  }
  const encoder = files.some((name) => name.endsWith('-encoder.int8.onnx'))
    ? pick('-encoder.int8.onnx')
    : pick('-encoder.onnx')
  const decoder = files.some((name) => name.endsWith('-decoder.int8.onnx'))
    ? pick('-decoder.int8.onnx')
    : pick('-decoder.onnx')
  return { encoder, decoder, tokens: pick('tokens.txt'), variant: path.basename(encoder) }
}

/** Parse a mono PCM16 WAV and resample it to 16 kHz. */
function readWav(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('запись не является WAV-файлом')
  }
  let offset = 12
  let sampleRate = 0
  let channels = 0
  let bits = 0
  let dataStart = -1
  let dataLength = 0
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4)
    const size = buf.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      channels = buf.readUInt16LE(body + 2)
      sampleRate = buf.readUInt32LE(body + 4)
      bits = buf.readUInt16LE(body + 14)
    } else if (id === 'data') {
      dataStart = body
      dataLength = Math.min(size, buf.length - body)
      break
    }
    offset = body + size + (size % 2)
  }
  if (dataStart < 0) throw new Error('в WAV нет блока data')
  if (sampleRate <= 0) throw new Error('в WAV нет корректной частоты дискретизации')
  if (channels !== 1) throw new Error(`ожидается моно, получено каналов: ${channels}`)
  if (bits !== 16) throw new Error(`ожидается 16-битный PCM, получено ${bits} бит`)
  const count = Math.floor(dataLength / 2)
  let samples = new Float32Array(count)
  for (let i = 0; i < count; i += 1) samples[i] = buf.readInt16LE(dataStart + i * 2) / 32768
  const audioSeconds = count / sampleRate
  if (sampleRate !== 16000) samples = resample(samples, sampleRate, 16000)
  return { samples, audioSeconds }
}

/** Linear resampling to the recognizer's 16 kHz input. */
function resample(samples, from, to) {
  const ratio = from / to
  const length = Math.floor(samples.length / ratio)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i += 1) {
    const position = i * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, samples.length - 1)
    const weight = position - left
    out[i] = samples[left] * (1 - weight) + samples[right] * weight
  }
  return out
}

/** Build (or rebuild) the recognizer for one model directory and language. */
function ensureRecognizer(modelDir, language, threads) {
  const files = modelFiles(modelDir)
  const key = `${modelDir}|${files.variant}|${language}|${threads}`
  if (recognizer !== null && loaded === key) return recognizer
  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      whisper: {
        encoder: files.encoder,
        decoder: files.decoder,
        language,
        task: 'transcribe',
      },
      tokens: files.tokens,
      numThreads: threads,
      provider: 'cpu',
      debug: 0,
    },
  }
  recognizer = new sherpa.OfflineRecognizer(config)
  loaded = key
  return recognizer
}

parentPort.on('message', (message) => {
  const started = performance.now()
  try {
    const { samples, audioSeconds } = readWav(message.wav)
    const modelDir = String(message.modelDir)
    const language = message.language === 'auto' ? '' : String(message.language || 'ru')
    const threads = Number(message.threads) > 0 ? Number(message.threads) : 2
    const asr = ensureRecognizer(modelDir, language, threads)
    const stream = asr.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples })
    asr.decode(stream)
    const result = asr.getResult(stream)
    parentPort.postMessage({
      id: message.id,
      ok: true,
      text: String(result.text || '').trim(),
      audioSeconds,
      inferenceSeconds: (performance.now() - started) / 1000,
    })
  } catch (error) {
    parentPort.postMessage({
      id: message.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
