# Перенос и установка dsh-whisper-sherpa

Плагин голосового ввода Whisper для DSH. Самодостаточен: рантайм sherpa-onnx
лежит внутри пакета, снаружи нужна только модель.

## Что копировать

1. `dsh-whisper-sherpa-0.1.0.tgz` — сам плагин (~8,6 МБ).
2. Опционально: папку модели `sherpa-onnx-whisper-small` (~357 МБ):
   `%USERPROFILE%\.dsh\speech-to-text\whisper-local\sherpa-onnx-whisper-small`
   Без неё плагин скачает модель сам (610 МБ с GitHub) при подготовке.

## Установка

Самый простой путь — попросить агента в DSH:

> Установи плагин из файла `D:\transfer\dsh-whisper-sherpa-0.1.0.tgz`

Агент вызовет `plugin_manager install_bundle` со спецификацией `file:...`
(потребуется разрешение danger-full-access).

Либо скриптом в обычном терминале (не из песочницы агента):

```powershell
.\install.ps1 -Package .\dsh-whisper-sherpa-0.1.0.tgz
```

Профиль: `desktop` для DSH Desktop, `web` для `dsh web` — параметр `-Profile`.

## Если копируете модель

Положите папку так, чтобы путь совпал:

```
%USERPROFILE%\.dsh\speech-to-text\whisper-local\sherpa-onnx-whisper-small\
    small-encoder.int8.onnx
    small-decoder.int8.onnx
    small-tokens.txt
```

Плагин сам определит готовность (snapshot перепроверяет каталог при каждом
обращении), скачивание не запустится.

## Включение

**Плагины → «Голосовой ввод» → Сведения**:
- Провайдер: `Whisper small (local)`
- Язык распознавания: `Русский (ru)`

Затем микрофон в строке ввода. Первая фраза — с загрузкой модели (+3 с),
дальше ~6 с на 6–7 с речи (CPU, 4 потока).

## Требования

- Windows x64 (в пакете только `sherpa-onnx-win-x64`).
- DSH с сервисом `speechToText` (ветка 0.2.x).
- Свободно ~1 ГБ на диске (модель + временный архив при скачивании).
