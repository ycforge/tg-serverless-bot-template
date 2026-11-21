# Архитектура и IAM

[← README](../README.md)

## Компоненты

| Компонент | Ответственность |
| --- | --- |
| Telegram-триггер | Доставляет Telegram Update в функцию бота |
| Bot Cloud Function | Обрабатывает `/start`, `ping`, `/ping`; отправляет ответы через Bot API |
| API Gateway | Публичный HTTPS-вход: статика из приватного бакета и вызовы приватного API |
| Object Storage | Собранный React-фронтенд |
| API Cloud Function | NestJS, проверка Telegram `initData`, операции личного счётчика |
| YDB | Значения счётчиков и идентификаторы выполненных операций |
| Lockbox и KMS | Хранение и шифрование токена бота |
| Cloudflare Worker | Необязательный исходящий прокси Bot API; не обслуживает TMA API или входящие обновления |

Gateway передаёт `/api/*` в NestJS через [YC-коннектор](https://github.com/ycforge/serverless-tools), `/` и остальные пути — в Object Storage. Конфигурация находится в [gateway.yaml.tftpl](../infra/gateway.yaml.tftpl). Оба приложения используют один origin; дополнительная CORS-конфигурация для TMA не требуется.

## Разделение прав

| Аккаунт | Права и область |
| --- | --- |
| Deployer | Локальное управление развёртыванием; не используется как runtime |
| Invoker | Общий для Telegram-триггера и CF-интеграции Gateway; `functions.functionInvoker` на две функции |
| Frontend reader | `storage.viewer` только на бакет фронтенда; используется Gateway |
| Bot runtime | `lockbox.payloadViewer` на секрет и `kms.keys.encrypterDecrypter` на связанный KMS-ключ, если он есть |
| API runtime | Доступ к тому же секрету и KMS-ключу, плюс `ydb.editor` на выбранную базу |

Invoker не получает права на секреты, базу или S3. Runtime-аккаунты не получают права вызывать другие функции. Права на конкретные ресурсы описаны в [infra/main.tf](../infra/main.tf).

Для существующего секрета Terraform определяет связанный KMS-ключ и при необходимости добавляет права runtime-аккаунтам. Существующие назначения на секрет и ключ сохраняются.

## Границы Terraform

Terraform управляет идентичностями функций, Gateway, бакетом, сервисными аккаунтами и IAM. При отсутствии внешних ID он также создаёт YDB, Lockbox и KMS.

Провайдеру нужна начальная версия функции: новый ресурс создаётся с bootstrap-обработчиком, возвращающим `503`. Затем скрипт публикации заменяет её рабочей версией. Поля версий исключены из последующего управления через `lifecycle.ignore_changes`: обычный `terraform apply` не откатывает опубликованный код.

Вне Terraform остаются:

- Версии кода функций и объекты собранного фронтенда.
- Payload секрета и SQL-миграции.
- Telegram-триггер, настраиваемый отдельной командой.
- Необязательный Cloudflare Worker.

## Хранение данных

[SQL-схема](../db/001-counters.sql) содержит две таблицы: `tg_example_counters` и `tg_example_operations`. Ключ счётчика — Telegram ID проверенного автора, а не значение из тела запроса.

Изменение счётчика и регистрация операции выполняются в одной serializable read-write транзакции. Повтор `(user_id, operation_id)` с прежним `delta` не применяет изменение снова; с другим `delta` возвращает `409`.

Фронтенд сохраняет только незавершённую операцию в localStorage, чтобы повторить запрос после неопределённого сетевого результата. `initData` в localStorage не записывается.

## Дополнительные материалы

- [Telegram trigger](https://yandex.cloud/ru/docs/functions/concepts/trigger/telegram-trigger)
- [API Gateway → Object Storage](https://yandex.cloud/ru/docs/api-gateway/concepts/extensions/object-storage)
- [API Gateway → Cloud Functions](https://yandex.cloud/ru/docs/api-gateway/concepts/extensions/cloud-functions)
- [YDB JavaScript SDK](https://ydb.js.org/guide/core)
