# dsh-whisper-sherpa

Offline speech-to-text for **DeepSeek Harness** voice input, powered by Whisper on
`sherpa-onnx`. Audio is recognised on your machine; the network is used once, to
download the model. **Russian is supported** вЂ” which the built-in SenseVoice
provider (auto/zh/en/yue/ja/ko) cannot do.

> Community plugin. Not an official DeepSeek plugin, not affiliated with OpenAI
> (Whisper) or the DeepSeek team.

## Features

- **Offline.** The recording never leaves the machine: no cloud calls, no keys,
  no accounts.
- **Language hints:** `auto`, `ru`, `en`, `de`, `es`, `fr`, `pt`, `zh`, `ja`, `ko`.
- **Model choice:** `tiny` / `base` / `small` / `medium` through the `model` config.
- **Managed download** with progress in the plugin settings; an existing model is
  reused, nothing is fetched again.
- **Non-blocking:** decoding runs in a worker thread, the Host event loop stays free.
- **Self-contained runtime:** sherpa-onnx ships inside the package (Windows x64).

## How it works

```
DSH microphone button (16 kHz mono PCM16 WAV)
  в””в”Ђ speechToText в†’ dsh-whisper-sherpa provider
       в”њв”Ђ WAV validated, resampled to 16 kHz when needed
       в”њв”Ђ worker thread: sherpa-onnx OfflineRecognizer (Whisper, int8)
       в””в”Ђ { text, audioSeconds, inferenceSeconds } в†’ draft text
```

The provider registers through `ctx.speechToText.register()` and advertises
`location: 'host-local'`, so the stock voice panel lists it and offers preparation.

## Requirements

| | |
|---|---|
| DSH | 0.2.x with the **Voice input** bundle enabled |
| OS | Windows x64 (only `sherpa-onnx-win-x64` is bundled) |
| Disk | ~360 MB for the `small` int8 model, ~22 MB runtime inside the package |
| CPU | any x64; 4 threads by default, no GPU |
| Network | once, to download the model from GitHub |

## Install

### From GitHub

**Plugins в†’ Add plugin в†’ Install a third-party plugin**:

```text
git+https://github.com/YegorIl/dsh-whisper-sherpa.git
```

Pin a tag for reproducibility: `вЂ¦#v0.1.0`.

### From a local tarball

```powershell
.\install.ps1 -Package .\dsh-whisper-sherpa-0.1.0.tgz
```

The script locates the DSH runtime (node, pnpm) and calls the stock CLI. You can
also ask the DSH agent to install the file through `plugin_manager install_bundle`.

### After installation

Enable the **Voice input** bundle, then **Plugins в†’ Voice input в†’ Details**:
provider `Whisper small (local)`, language `Russian (ru)`. If the model is missing,
run preparation вЂ” the first phrase additionally loads the model.

## Models

Downloaded from the public
[k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
release into `%USERPROFILE%\.dsh\speech-to-text\whisper-local\`.

| Key | Archive | On disk (int8) | Notes |
|---|---|---|---|
| `tiny` | 111 MB | ~98 MB | fast, weak Russian |
| `base` | вЂ” | вЂ” | middle ground, untested |
| `small` | 610 MB | ~357 MB | **default**, good quality |
| `medium` | 1.8 GB | вЂ” | more accurate, slower, untested |

### Measured speed

CPU, 4 threads, `small` int8, 6.7 s recording:

- first call **~12 s** (model load included);
- afterwards **~6.1 s** per phrase (~0.9Г— realtime);
- `tiny`: ~2.7 s, visibly worse Russian.

This is not instant dictation. For fast cloud input use a Web Speech API plugin;
this one is about privacy and working without network.

## Configuration

Defaults come from `cordis.patch.yml`:

```yaml
- insert:
    - id: whisper-local
      name: dsh-whisper-sherpa
      config:
        dataRoot: !!js dshHomePath('speech-to-text', 'whisper-local')
        model: small
```

| Field | Default | Meaning |
|---|---|---|
| `dataRoot` | `%USERPROFILE%\.dsh\speech-to-text\whisper-local` | where models live |
| `model` | `small` | `tiny` \| `base` \| `small` \| `medium` |
| `threads` | `4` | CPU threads per decode |
| `providerId` | `whisper-local` | registry id (leave as is) |
| `maxAudioBytes` | `8388608` | recording size limit |

Override in the profile's own patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`).

## Privacy

- Audio stays local; nothing is uploaded, no keys are involved.
- The only network request is the model download from GitHub, started explicitly.
- No temporary audio files are written.
- You can pre-place the model into `dataRoot` and never touch the network.

## Troubleshooting

**The provider is missing.** Check the bundle is installed and enabled, then
restart DSH вЂ” host modules load once per process.

**"The local Whisper model is not ready".** Open **Plugins в†’ Voice input в†’
Details** and run preparation.

**`tar.exe` errors.** Extraction uses the system `tar.exe`. Otherwise unpack the
archive manually into `dataRoot\sherpa-onnx-whisper-small\`.

**Slow.** Use `base`/`tiny`, or raise `threads`. Inference is CPU-only.

**Wrong language.** Select `Russian (ru)` instead of `auto`; auto-detection is
unreliable on short phrases.

## Development

No build step; plain ESM.

| File | Role |
|---|---|
| `lib/index.js` | provider registration, preparation, worker lifecycle |
| `lib/worker.cjs` | worker thread: sherpa-onnx Whisper, WAV parsing |
| `vendor/` | `sherpa-onnx-node` 1.13.8 (Apache-2.0) |
| `sherpa-onnx-win-x64/` | native runtime (Apache-2.0) + onnxruntime (MIT) |
| `cordis.patch.yml` | loader entry |
| `install.ps1` | tarball installer |

```powershell
pnpm pack        # в†’ dsh-whisper-sherpa-0.1.0.tgz
node tools/test-worker.mjs <path.wav> <modelDir> ru
```

## License and attribution

Plugin code is **MIT** (see [LICENSE](LICENSE)).

Vendored components:

- **sherpa-onnx** 1.13.8 вЂ” Apache-2.0, <https://github.com/k2-fsa/sherpa-onnx>
- **ONNX Runtime** вЂ” MIT, Microsoft
- **Whisper** weights (not bundled) вЂ” MIT, OpenAI

Full texts are in [`LICENSES/`](LICENSES/), the summary in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Files under `vendor/` and
`sherpa-onnx-win-x64/` are unmodified.

вЂњWhisperвЂќ is a product name of OpenAI; вЂњDeepSeek HarnessвЂќ belongs to DeepSeek.
Both are used descriptively; this project is not affiliated with or endorsed by
either.

---

[Р СѓСЃСЃРєР°СЏ РІРµСЂСЃРёСЏ](README.md)
