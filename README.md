# ToniVecherRadio

Веб-радиостанция с синхронизированным эфиром на три канала (`Основной`, `Deep`, `Downtempo`), клиентским Web Audio DSP-эквалайзером, отметками на волне и чатом через SSE.

## Архитектура

Приложение разделено на SPA-клиент и серверную часть без внешних npm-зависимостей в рантайме бэкенда.

- **Фронтенд (`src/`)**: интерфейс на React 19 и TypeScript. Клиент получает текущую позицию эфира от сервера, удерживает фазовую синхронизацию аудиопотока (`src/audio/liveSync.ts`), обрабатывает звук через 10-полосный эквалайзер и 5 макро-регуляторов на Web Audio API (`src/audio/dspEngine.ts`), рисует волну с тепловой картой реакций (`src/components/WaveformTimeline.tsx`) и принимает события в реальном времени через `EventSource` (`src/hooks/useLiveRadioState.ts`). Логика сессии, транспорта, DSP и Media Session вынесена в хуки `src/hooks/`.
- **Бэкенд (`server/`)**: HTTP-сервер на `node:http` и встроенном `node:sqlite`. При старте сканирует каталоги с аудиофайлами (`.m4a`, `.mp3`, `.flac`, `.wav`, `.aiff`, `.ogg` размером от 5 МБ), определяет длительность через `ffprobe`, пересобирает поток без исходных метаданных в кеш через `ffmpeg` (`server/media.mjs`) и раздаёт аудио с поддержкой HTTP `206 Partial Content`. В фоне извлекает пики волны (`server/waveform.mjs`), хранит отметки, лайки, чат и пользователей (вход по PoW-задаче и PIN-коду, либо гостевая сессия) в SQLite и рассылает обновления по SSE (`/api/radio/events`). При наличии собранного `dist/` отдаёт статику вместе с `public/`.

## Стек

- Node.js со встроенным модулем `node:sqlite` (проверено на v26.5.0)
- `ffmpeg` и `ffprobe` в `PATH` (или в `/opt/homebrew/bin`, `/usr/local/bin`)
- React 19, TypeScript 5.7, Vite 6, Tailwind CSS 4, Framer Motion

## Структура директорий

| Путь | Назначение |
| --- | --- |
| `index.html` | HTML-оболочка и стартовый экран до загрузки бандла |
| `src/` | Клиентский код: `audio/`, `components/`, `components/icons/`, `constants/`, `hooks/`, `styles/`, `types/`, `utils/` |
| `public/` | Статические файлы: фавиконки и манифест (`brand/`), шрифты (`fonts/`), фоновые медиа (`media/`) |
| `server/` | HTTP/SSE-сервер (`index.mjs`), SQLite-слой (`db.mjs`), медиа-кеш (`media.mjs`), волна (`waveform.mjs`), безопасность (`security.mjs`), статика (`static.mjs`) |
| `tests/` | Утилиты (`helpers.mjs`), серверные регрессионные тесты (`regression.mjs`), браузерные сценарии (`browser.mjs`), smoke-проверка стенда (`public-smoke.mjs`) и раннер (`run.mjs`) |

## Локальный запуск

1. Установите зависимости:

```bash
npm install
```

2. Соберите фронтенд и убедитесь, что каталоги для данных и кеша доступны для записи:

```bash
npm run build
```

3. Поместите аудиофайлы в `server/sets/` или задайте путь в `RADIOTV_SETS_DIRS`. По умолчанию сервер пишет очищенные аудиофайлы в `/var/cache/radiotv/audio`, поэтому для локального запуска без прав на `/var/cache` укажите локальный каталог, например `./server/cache`.

4. Запустите сервер:

```bash
RADIOTV_AUDIO_CACHE=./server/cache npm start
```

Сервер поднимется на `http://127.0.0.1:4321`.

Для разработки фронтенда с HMR в первом терминале оставьте запущенным сервер (`npm start`), а во втором запустите Vite dev-сервер (порт `5173`, прокси `/api` на `http://127.0.0.1:4321`):

```bash
npm run dev
```

## Переменные окружения

Шаблон с комментариями находится в [`.env.example`](./.env.example).

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `4321` | Порт HTTP-сервера |
| `RADIOTV_HOST` | `127.0.0.1` | Хост, на котором сервер принимает подключения |
| `RADIOTV_DATA_DIR` | `./server` | Каталог с базой `radiotv.sqlite` и подкаталогом `sets/` по умолчанию |
| `RADIOTV_SETS_DIRS` | `<RADIOTV_DATA_DIR>/sets` | Список каталогов с аудиосетами через `:` (на Windows `;`) |
| `RADIOTV_AUDIO_CACHE` | `/var/cache/radiotv/audio` | Каталог кеша пересобранных аудиофайлов без метаданных |
| `RADIOTV_SECRET` | из `server/.secret` | Секрет подписи токенов (>= 32 символов); при отсутствии файла генерируется автоматически |
| `RADIOTV_TRUSTED_PROXIES` | пусто | Доверенные IP прокси через запятую для чтения `X-Forwarded-For` |
| `RADIOTV_PREVIEW_API` | пусто | Прокси `/api` для `vite dev`; при задании включает read-only режим (блокирует мутирующие запросы) |

## Сборка и тесты

- `npm run typecheck`: проверка типов TypeScript (`tsc --noEmit`).
- `npm run build`: проверка типов и production-сборка клиента в `dist/`.
- `npm test`: запускает `node tests/run.mjs`. Скрипт проверяет актуальность сборки `dist/`, генерирует три тестовых WAV-файла через `ffmpeg` во временной директории ОС, поднимает изолированный сервер на случайном порту и запускает `node --test tests/regression.mjs`. Если установлен `playwright` или задан `PLAYWRIGHT_MODULE_PATH`, дополнительно запускает `tests/browser.mjs` (с флагом `--with-browser` отсутствие Playwright считается ошибкой). Временные данные удаляются по завершении; скриншоты и JSON-отчёты сохраняются только при заданной переменной `RADIOTV_EVIDENCE_DIR`.
- `node tests/public-smoke.mjs`: smoke-проверка публичного стенда (по умолчанию `https://radio.tonivecher.online` или `RADIOTV_PUBLIC_URL`), требует `playwright` или `PLAYWRIGHT_MODULE_PATH`.
