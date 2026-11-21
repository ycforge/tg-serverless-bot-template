# Шаблон Telegram-бота и Mini App на Yandex Cloud Serverless

Репозиторий-шаблон Telegram-бота и Mini App с личным счётчиком в YDB. Бот отвечает `pong` на `ping` и открывает приложение по `/start`. Mini App автоматически подтверждает пользователя через подписанные данные Telegram и сохраняет изменения счётчика между запусками.

**Стек:** Node.js 22, TypeScript, NestJS, React, Vite, YDB, Cloud Functions, API Gateway, Object Storage, Lockbox, Terraform. В репозитории также есть необязательный прокси Telegram Bot API для Cloudflare Workers.

Это шаблон для собственного проекта, а не готовый production-сервис. Мониторинг, SLA, ограничение частоты запросов и другие эксплуатационные гарантии в него не входят; ограничения перечислены [ниже](#ограничения).

## Содержание

- [Возможности](#возможности)
- [Как это устроено](#как-это-устроено)
- [Быстрый старт](#быстрый-старт)
- [Команды](#команды)
- [Структура проекта](#структура-проекта)
- [Документация](#документация)
- [Ограничения](#ограничения)
- [Лицензия](#лицензия)

## Возможности

- `/start` в личном чате показывает кнопку открытия Mini App; `ping` и `/ping` возвращают `pong`.
- У каждого пользователя собственный счётчик с кнопками `−1`, `+1` и обновлением значения.
- Авторизация без отдельной кнопки входа: сервер проверяет HMAC и срок действия `initData`.
- Переиспользуемый NestJS-модуль с guard и декораторами пользователя, получателя, чата и контекста.
- Транзакционные изменения в YDB и защита от повторного выполнения одной операции.
- Единый публичный адрес для статики и API; функции и бакет закрыты от прямого публичного доступа.
- Раздельные сервисные аккаунты, токен бота в Lockbox, инфраструктура через Terraform.
- Remote Terraform state в Yandex Object Storage с версионированием и блокировкой.
- GitHub Actions для проверок без облачных секретов.

## Как это устроено

```text
Telegram → Telegram trigger → Bot Cloud Function → Telegram Bot API
                                  │                напрямую или через Worker
                                  └─ /start → кнопка Mini App

Telegram WebView → API Gateway
                    ├─ /, /assets/* → Object Storage
                    └─ /api/*       → NestJS Cloud Function → YDB
                                           │
                                      Lockbox BOT_TOKEN
```

Браузер обращается к относительным `/api/*`. Адрес функции и токен бота не зашиваются во фронтенд. Telegram-триггер доставляет обновления боту; отдельный HTTP webhook в приложении не реализован.

Terraform создаёт инфраструктуру. Версии функций, файлы фронтенда, SQL-миграции и Telegram-триггер публикуются отдельными скриптами. Состояние Terraform хранится в отдельном S3-бакете, а не в рабочей копии. Подробнее — [архитектура и права доступа](docs/architecture.md) и [remote state](docs/terraform-state.md).

## Быстрый старт

### 1. Подготовьте окружение

Понадобятся:

- Node.js **22.x, не ниже 22.15**; версия для `nvm` указана в [.nvmrc](.nvmrc).
- [Terraform](https://developer.hashicorp.com/terraform/install) **1.11+** (нужен для S3 lockfile), [Yandex Cloud CLI](https://yandex.cloud/ru/docs/cli/quickstart) и утилита `zip`.
- Каталог Yandex Cloud с подключённым биллингом и авторизованный JSON-ключ сервисного аккаунта для развёртывания.
- Telegram-бот, созданный через [BotFather](https://t.me/BotFather), и его токен.
- Отдельный S3-бакет для Terraform state и ключ доступа к Object Storage. Бакет создаётся bootstrap-конфигурацией; его имя задаётся в `TF_STATE_BUCKET`.

Команды выполняются из корня скачанного или клонированного репозитория в macOS/Linux. Для Windows используйте WSL.

```bash
npm ci
cp .env.example .env
chmod 600 .env
```

### 2. Заполните `.env`

Обязательные настройки:

```dotenv
YC_SERVICE_ACCOUNT_KEY_FILE=/absolute/path/to/authorized_key.json
YC_FOLDER_ID=<your-folder-id>
BOT_TOKEN=<your-bot-token>
TF_STATE_BUCKET=<your-state-bucket>
```

Для нового развёртывания оставьте `BOT_SECRET_ID`, `BOT_SECRET_VERSION_ID` и `EXISTING_YDB_ID` пустыми: будут созданы новая база и секрет. Выберите уникальные `PROJECT_NAME` и `TELEGRAM_TRIGGER_NAME`; `PROJECT_NAME` входит в имя рабочего бакета и ключ state по умолчанию.

Для доступа к state-бакету задайте в окружении `AWS_ACCESS_KEY_ID` и `AWS_SECRET_ACCESS_KEY` от сервисного аккаунта Object Storage. Не коммитьте эти значения и не передавайте их как backend-параметры в Git или CI. Подробнее — [конфигурация](docs/configuration.md).

`TG_PROXY_BASE=https://api.telegram.org/bot` использует Telegram напрямую. Если требуется прокси, сначала [разверните Worker](workers/telegram-proxy/README.md) и укажите `TG_PROXY_BASE=https://<your-worker-host>/bot`. Токен к этому значению добавлять не нужно.

### 3. Создайте state-бакет и разверните

```bash
npm run infra:bootstrap -- plan
npm run infra:bootstrap -- apply
npm run typecheck
npm test
npm run build
npm run infra:plan
npm run infra:apply
npm run deploy:apps
npm run trigger:ensure
npm run verify
```

`infra:bootstrap` использует отдельную локальную конфигурацию в [infra/bootstrap](infra/bootstrap): она создаёт версионированный приватный бакет для state и не входит в основной state. `infra:plan` и последующие команды инициализируют S3 backend и используют lockfile. Изучите план перед `infra:apply`: команда применяет сохранённый план без дополнительного интерактивного подтверждения. Созданные облачные ресурсы могут тарифицироваться.

Если у вас уже есть локальный `infra/terraform.tfstate`, сначала перенесите его в S3 командой `npm run infra:state:migrate` и подтвердите копирование. Не запускайте создание инфраструктуры существующего стенда с потерянным state. Порядок первого запуска, миграции и восстановления описан в [remote state](docs/terraform-state.md).

`trigger:ensure` отдельно создаёт Telegram-триггер через официальный REST API либо обновляет цель существующего триггера с тем же именем. Токен читается из `.env`. Terraform этим триггером не управляет.

После проверки конфигурации сборку и развёртывание можно объединить: `npm run deploy`, затем `npm run verify`. Worker в эту команду не входит.

### 4. Откройте приложение

Отправьте боту `/start` в **личном чате**, нажмите «Открыть счётчик» и измените значение. После повторного открытия оно должно сохраниться. `ping` должен получить ответ `pong`.

Открытие URL в обычном браузере позволяет увидеть страницу, но не предоставляет подписанные данные Telegram. Для входа приложение нужно запустить из Telegram.

## Команды

| Команда | Назначение |
| --- | --- |
| `npm run dev` | Локальный Vite-сервер фронтенда; не запускает NestJS или облачные ресурсы |
| `npm run typecheck` | Проверка типов приложений |
| `npm test` | Локальные тесты подписи, guard, декораторов, HTTP-адаптера, счётчика, бота, фронтенда и Worker |
| `npm run build` | Сборка приложений и архивов функций в `build/` |
| `npm run infra:bootstrap -- plan` | План отдельного state-бакета |
| `npm run infra:bootstrap -- apply` | Создание state-бакета |
| `npm run infra:state:migrate` | Перенос существующего локального state в S3 |
| `npm run infra:plan` | Инициализация backend, валидация и план Terraform |
| `npm run infra:apply` | Планирование и применение инфраструктуры |
| `npm run deploy:apps` | SQL-миграция, публикация двух функций и загрузка фронтенда |
| `npm run trigger:ensure` | Отдельная настройка Telegram-триггера |
| `npm run deploy` | Сборка → инфраструктура → приложения → триггер |
| `npm run verify` | Проверка развёрнутого стенда с временными записями в YDB |

При изменении только кода: `npm run build`, `npm test`, `npm run deploy:apps`, `npm run verify`. Триггер пересоздавать не нужно.

## Структура проекта

```text
apps/
  bot/src/               Telegram Update, /start и ping/pong
  api/src/               NestJS-контроллеры, авторизация TMA и работа с YDB
    telegram/            TelegramAuthModule, guard, сервис и декораторы
  web/src/               React Mini App
db/                      SQL-схема счётчиков и выполненных операций
infra/                   Terraform, S3 backend и шаблон API Gateway
infra/bootstrap/         Отдельная конфигурация state-бакета
scripts/                 Сборка, развёртывание, миграции и обслуживание
tests/                   Локальные тесты
workers/telegram-proxy/   Необязательный Cloudflare Worker для Bot API
docs/                    Подробная документация
```

## Документация

- [Конфигурация и секреты](docs/configuration.md) — `.env`, существующие YDB/Lockbox, сервисный аккаунт развёртывания.
- [Архитектура и IAM](docs/architecture.md) — границы Terraform, маршрутизация, роли, данные и идемпотентность.
- [Авторизация и API](docs/authentication.md) — проверка `initData`, окно действия, NestJS-декораторы, форматы запросов.
- [Terraform state в Object Storage](docs/terraform-state.md) — bootstrap, credentials, locking, миграция и восстановление.
- [Telegram Bot API proxy](workers/telegram-proxy/README.md) — исходник Worker, развёртывание и подключение.
- [Разработка и диагностика](docs/development.md) — тесты, локальный интерфейс, CI, типовые ошибки.
- [Обслуживание и восстановление](docs/operations.md) — обновления, резервные копии и пересоздание тестового каталога.
- [Участие в проекте](CONTRIBUTING.md) — изменения, проверки и pull request.

## Ограничения

- Шаблон не содержит мониторинга, SLA и ограничения частоты запросов на стороне TMA API.
- Cloud Logging исключён из управления; приложение пишет в stdout, отдельное хранилище логов не настраивается.
- Окно авторизации — это срок действия подписанного Telegram `initData`, а не отдельная серверная сессия. По умолчанию `auth_date` должен быть не старше 3600 секунд; допускается расхождение часов в будущее до 30 секунд. Для получения свежих данных откройте Mini App заново. Настройки и причины ограничения описаны в [авторизации](docs/authentication.md).
- Таблица `tg_example_operations` — журнал идемпотентности для повторных запросов, а не история действий для интерфейса. Она растёт с каждым новым `operationId`; автоматического retention нет. При добавлении TTL или очистки учитывайте окно повторных попыток, включая `counter-pending:<user_id>` в localStorage, и не теряйте dedup молча. Подробнее — [архитектура](docs/architecture.md#хранение-данных).
- Диапазон счётчика ограничен естественным типом YDB `Int64`: от `−9 223 372 036 854 775 808` до `9 223 372 036 854 775 807`. Искусственного предела `±1 000 000 000` нет; выход за границу возвращает `409` с понятной ошибкой.
- Функции обновляются последовательно; общего автоматического отката приложений нет.
- Terraform state хранится в S3-совместимом Object Storage. State может содержать чувствительные значения, поэтому доступ к бакету и ключам ограничивается, а версионирование и lockfile обязательны. Локальный state поддерживается только для первичной миграции и bootstrap-конфигурации.
- Worker использует лимиты и статистику в памяти отдельного isolate, а не общий распределённый лимитер.

## Лицензия

Исходники распространяются по [MIT License](LICENSE). Copyright (c) 2026 Template contributors.
