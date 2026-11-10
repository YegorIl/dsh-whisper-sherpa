# dsh-whisper-sherpa

Локальный голосовой ввод для **DeepSeek Harness** на Whisper: звук распознаётся
на вашем компьютере, **русский язык поддерживается**, интернет нужен только
один раз — чтобы скачать модель.

Встроенный голосовой ввод DSH работает на SenseVoice и знает только `auto`,
китайский, английский, кантонский, японский и корейский. Этот плагин добавляет
в тот же интерфейс отдельного провайдера на **Whisper** через `sherpa-onnx`:
выбрали его один раз — и диктуете по-русски.

> Это community-плагин, не официальный плагин DeepSeek. Не связан с OpenAI
> (Whisper) и с командой DeepSeek.

## Возможности

- **Офлайн.** Аудио не покидает машину: запись → локальный распознаватель → текст.
  Никаких ключей, аккаунтов и облачных вызовов.
- **Русский и ещё 8 языков**: `auto`, `ru`, `en`, `de`, `es`, `fr`, `pt`, `zh`, `ja`, `ko`.
- **Выбор модели**: tiny / base / small / medium (ключ `model` в конфигурации).
- **Загрузка модели с прогрессом** прямо в настройках плагина; уже скачанная
  модель переиспользуется, повторно ничего не качается.
- **Не блокирует хост**: распознавание идёт в отдельном worker-потоке.
- **Свой рантайм**: sherpa-onnx уже внутри пакета (~22 МБ DLL), ничего
  дополнительно ставить не нужно.

## Как это работает

```
кнопка микрофона в DSH (запись 16 кГц, моно, PCM16)
  └─ speechToText → провайдер dsh-whisper-sherpa
       ├─ WAV проверяется и при необходимости ресемплится в 16 кГц
       ├─ worker thread: sherpa-onnx OfflineRecognizer (Whisper, int8)
       └─ { text, audioSeconds, inferenceSeconds } → текст в черновик
```

Провайдер регистрируется через `ctx.speechToText.register()` и рекламируется как
`location: 'host-local'`, поэтому штатная панель голосового ввода показывает его
в списке и позволяет запустить подготовку.

## Требования

| Что | Детали |
|---|---|
| DSH | 0.2.x с включённым бандлом **Voice input** (`@deepseek-ai/dsh-experimental-voice-input-bundle`) |
| ОС | Windows x64 (в пакете только сборка `sherpa-onnx-win-x64`) |
| Диск | ~360 МБ под модель `small` (int8) + ~22 МБ рантайма в пакете |
| CPU | любой x64; 4 потока по умолчанию, GPU не используется |
| Сеть | один раз, для скачивания модели с GitHub |

## Установка

### 1. Из GitHub

**Plugins → Add plugin → Install a third-party plugin** и указать адрес:

```text
git+https://github.com/YegorIl/dsh-whisper-sherpa.git
```

Для воспроизводимости можно закрепить тег: `…#v0.1.0`.

### 2. Из локального tarball

```powershell
.\install.ps1 -Package .\dsh-whisper-sherpa-0.1.0.tgz
```

Скрипт сам находит рантайм DSH, node и pnpm и вызывает штатную CLI
(`dsh plugin --profile desktop add …`). Либо попросите агента в DSH:
«установи плагин из файла …» — он вызовет `plugin_manager install_bundle`.

### 3. Из npm (если пакет опубликован)

```text
dsh-whisper-sherpa@0.1.0
```

### После установки

Включите бандл **Voice input**, затем **Plugins → Voice input → Details**:

- **Provider**: `Whisper small (local)`
- **Language**: `Русский (ru)`

Если модели ещё нет — нажмите подготовку (Download and prepare). Первая фраза
после подготовки — с загрузкой модели, дальше быстрее.

## Модели

Модели качаются с публичного релиза
[k2-fsa/sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models)
в `%USERPROFILE%\.dsh\speech-to-text\whisper-local\`.

| Ключ | Архив | На диске (int8) | Комментарий |
|---|---|---|---|
| `tiny` | 111 МБ | ~98 МБ | быстро, качество русского слабое |
| `base` | — | — | промежуточный вариант, не тестировался |
| `small` | 610 МБ | ~357 МБ | **по умолчанию**, хорошее качество |
| `medium` | 1,8 ГБ | — | точнее, заметно медленнее, не тестировался |

### Скорость (замер)

CPU, 4 потока, `small` int8, запись 6,7 с:

- первый вызов: **~12 с** (включая загрузку модели);
- дальше: **~6,1 с** на ту же фразу (~0,9× от длительности записи);
- `tiny`: ~2,7 с, но качество русского заметно хуже.

Это не мгновенная диктовка: для быстрого облачного ввода есть другие плагины
(Web Speech API), этот — про приватность и работу без сети.

## Конфигурация

Значения по умолчанию задаются патчем бандла (`cordis.patch.yml`):

```yaml
- insert:
    - id: whisper-local
      name: dsh-whisper-sherpa
      config:
        dataRoot: !!js dshHomePath('speech-to-text', 'whisper-local')
        model: small
```

| Поле | По умолчанию | Значение |
|---|---|---|
| `dataRoot` | `%USERPROFILE%\.dsh\speech-to-text\whisper-local` | куда качать и распаковывать модель |
| `model` | `small` | `tiny` \| `base` \| `small` \| `medium` |
| `threads` | `4` | потоков CPU на распознавание |
| `providerId` | `whisper-local` | id провайдера в реестре (менять не нужно) |
| `maxAudioBytes` | `8388608` | предел размера записи |

Переопределить можно в пользовательском слое профиля
(`~/.dsh/profiles/<profile>/cordis.patch.yml`).

## Приватность

- Аудио не отправляется никуда: распознавание целиком на машине.
- Единственный сетевой запрос плагина — скачивание модели с GitHub (по кнопке
  подготовки); в момент диктовки сеть не используется вообще.
- Временных файлов с аудио плагин не создаёт.
- Модель — не персональные данные, но и её можно скачать вручную и положить в
  `dataRoot`, если не хотите обращаться к GitHub.

## Устранение проблем

**Провайдера нет в списке.** Проверьте, что бандл установлен и включён
(**Plugins**), затем перезапустите DSH — модуль хоста загружается один раз.

**«The local Whisper model is not ready».** Откройте **Plugins → Voice input →
Details** и запустите подготовку; прогресс показывается в карточке.

**Ошибка `tar.exe`.** Распаковка идёт системным `tar.exe` (есть в Windows 10/11).
Если его нет — распакуйте скачанный архив вручную:

```
%USERPROFILE%\.dsh\speech-to-text\whisper-local\
    sherpa-onnx-whisper-small\
        small-encoder.int8.onnx
        small-decoder.int8.onnx
        small-tokens.txt
```

**Медленно.** Уменьшите модель (`base`/`tiny`) или увеличьте `threads`;
распознавание идёт на CPU.

**Неверный язык.** Убедитесь, что в настройках выбран `Русский (ru)`, а не `auto`:
на коротких фразах автоопределение ошибается.

## Разработка

Пакет без сборки: обычный ESM.

| Файл | Роль |
|---|---|
| `lib/index.js` | регистрация провайдера, подготовка, управление воркером |
| `lib/worker.cjs` | worker thread: sherpa-onnx Whisper, разбор WAV |
| `vendor/` | `sherpa-onnx-node` 1.13.8 (Apache-2.0) |
| `sherpa-onnx-win-x64/` | нативный рантайм (Apache-2.0) + onnxruntime (MIT) |
| `cordis.patch.yml` | запись загрузчика |
| `install.ps1` | установка из tarball |

Сборка архива:

```powershell
pnpm pack        # → dsh-whisper-sherpa-0.1.0.tgz
```

Проверка распознавания без DSH:

```powershell
node tools/test-worker.mjs <path.wav> <modelDir> ru
```

## Лицензии и атрибуция

Код плагина — **MIT** (см. [LICENSE](LICENSE)).

Вендорные компоненты:

- **sherpa-onnx** 1.13.8 — Apache-2.0, <https://github.com/k2-fsa/sherpa-onnx>
- **ONNX Runtime** — MIT, Microsoft
- **Whisper** (веса, отдельно от пакета) — MIT, OpenAI

Полные тексты — в [`LICENSES/`](LICENSES/), сводка — в
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Файлы `vendor/` и
`sherpa-onnx-win-x64/` не изменялись.

Название «Whisper» принадлежит OpenAI, «DeepSeek Harness» — DeepSeek;
используются описательно, проект не связан с ними и не одобрен ими.

---

[English version](README.en.md)
