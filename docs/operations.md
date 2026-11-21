# Обслуживание и восстановление

[← README](../README.md)

## Обновление приложений

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run deploy:apps
npm run verify
```

`deploy:apps` выполняет идемпотентную SQL-миграцию, публикует API и бота последовательно, загружает assets и затем HTML. Старые assets с хешами сохраняются для уже открытых WebView. Общего автоматического rollback двух функций нет.

Для изменения инфраструктуры используйте `npm run infra:plan`, изучите план, затем `npm run infra:apply`. Telegram-триггер создаётся отдельно через `npm run trigger:ensure` и при обычном обновлении кода не пересоздаётся.

## Telegram-триггер и смена токена

Скрипт [trigger.mjs](../scripts/trigger.mjs) использует официальный Serverless Triggers v2 REST API. Он не зависит от наличия команды Telegram в установленном YC CLI. Новый триггер создаётся без принудительного захвата чужой webhook-регистрации. Для существующего триггера с заданным именем скрипт сохраняет источник и при необходимости меняет только действие.

Смена токена или источника существующего триггера автоматически не выполняется. При ротации согласованно обновите локальный `BOT_TOKEN`, выбранную версию Lockbox и источник Telegram-триггера, затем опубликуйте функции. `deploy:apps` остановится, если токен в `.env` отличается от выбранного Lockbox payload. Не вызывайте `setWebhook` и не включайте polling параллельно платформенному триггеру.

Смена только `TG_PROXY_BASE` не требует пересоздания триггера: обновите `.env`, выполните `npm run build` и `npm run deploy:apps`. [Инструкция Worker](../workers/telegram-proxy/README.md).

## Резервная копия

```bash
node scripts/backup-folder.mjs /secure/backups/example/before
```

Нужны рабочие `.env`, Terraform state и права чтения ресурсов каталога. Копия сохраняет доступные версии Lockbox payload, конфигурации, объекты S3, схемы и строки YDB, Git HEAD и state. Она содержит секреты: каталог должен быть вне репозитория, с правами `0700`, файлы — `0600`. Скрипт проверяет SHA-256 и чтение записанных файлов.

KMS-ключ не экспортируется: сохранённые значения секретов могут быть зашифрованы новым ключом. Cloud Logging намеренно исключён из инвентаризации и удаления.

## Пересоздание выделенного тестового каталога

**Разрушительная процедура:** удаляются найденные ресурсы каталога, включая старые ресурсы вне Terraform state. Сам каталог, deployer и права владельца сохраняются. Выполняйте только в специально выделенном тестовом каталоге; это не обычная команда удаления проекта.

Пути ниже — примеры. Замените `FOLDER_ID` на ID того же каталога из `.env`.

```bash
# Снимок перед остановкой входящих запросов.
node scripts/backup-folder.mjs /secure/backups/example/before
node scripts/reset-folder.mjs freeze /secure/backups/example/before FOLDER_ID

# Финальный снимок после остановки триггеров и Gateway.
node scripts/backup-folder.mjs /secure/backups/example/frozen
node scripts/reset-folder.mjs destroy /secure/backups/example/frozen FOLDER_ID

# Восстановление токена, создание новой инфраструктуры и возврат данных.
node scripts/prepare-clean-env.mjs /secure/backups/example/frozen
npm run deploy
node scripts/restore-data.mjs /secure/backups/example/frozen
npm run verify
```

`freeze` удаляет входящие триггеры и Gateway и снимает старую webhook-регистрацию без удаления ожидающих сообщений. `destroy` проверяет копию и каталог, очищает S3, снимает защиту удаления, удаляет ресурсы и записывает проверку нулевого состояния в `zero-baseline.json`.

`prepare-clean-env` возвращает токен из проверенного payload и очищает ссылки на старые YDB/Lockbox в `.env`. `restore-data` восстанавливает две таблицы примера и сравнивает все строки чтением обратно.

Versioned S3 buckets, неизвестные таблицы YDB и другие виды инфраструктуры требуют отдельной процедуры. Не удаляйте копию до проверки восстановления. После пересоздания Gateway отправьте новый `/start`.

Terraform сам по себе не удаляет внешний Telegram-триггер. Для обычного удаления сначала остановите триггер, сохраните данные и учтите защиту YDB/Lockbox/KMS и непустой бакет. Повторно используемые внешние YDB/Lockbox не принадлежат state этого проекта.
