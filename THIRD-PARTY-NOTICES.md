# Third-party notices

`dsh-whisper-local` is MIT-licensed (see `LICENSE`). It also redistributes the
components below, each under its own license. The full texts are in `LICENSES/`.

| Component | Version | License | Where in this package |
|---|---|---|---|
| sherpa-onnx (`sherpa-onnx-node` JS wrapper) | 1.13.8 | Apache-2.0 | `vendor/*.js` |
| sherpa-onnx native runtime for Windows x64 | 1.13.8 | Apache-2.0 | `sherpa-onnx-win-x64/*.dll`, `sherpa-onnx-win-x64/sherpa-onnx.node` |
| ONNX Runtime | as shipped with sherpa-onnx 1.13.8 | MIT | `sherpa-onnx-win-x64/onnxruntime.dll`, `onnxruntime_providers_shared.dll` |
| Whisper model weights (not bundled) | `sherpa-onnx-whisper-small`, int8 | MIT (OpenAI Whisper) | downloaded at runtime from the k2-fsa release, see below |

License texts:

- `LICENSES/Apache-2.0-sherpa-onnx.txt` — Apache License 2.0
  (<https://github.com/k2-fsa/sherpa-onnx>, <https://k2-fsa.github.io/sherpa/onnx/>)
- `LICENSES/MIT-onnxruntime.txt` — MIT, Copyright (c) Microsoft Corporation
  (<https://github.com/microsoft/onnxruntime>)
- `LICENSES/MIT-whisper.txt` — MIT, Copyright (c) 2022 OpenAI
  (<https://github.com/openai/whisper>)

## Notes

- The vendored sherpa-onnx files are **unmodified copies** taken from the
  sherpa-onnx 1.13.8 release bundled with DeepSeek Harness 0.2.2-rc.1. No
  patches were applied to them; this package only adds its own files under
  `lib/` and the bundle configuration.
- The Whisper weights are **not** redistributed here. The plugin downloads
  `sherpa-onnx-whisper-<size>.tar.bz2` from the public k2-fsa GitHub release
  (`github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models`) into the user's own
  data directory on first preparation.
- `Whisper` is a product name of OpenAI, used here descriptively to identify
  the model family. This project is not affiliated with, endorsed by, or
  sponsored by OpenAI or DeepSeek.
- Trademarks of third parties remain the property of their owners; the
  Apache-2.0 license grants no trademark rights beyond customary descriptive
  use.
