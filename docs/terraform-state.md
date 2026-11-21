# Terraform state в Yandex Object Storage

[← README](../README.md)

Основной state Terraform хранится в S3-совместимом бакете Yandex Object Storage. Это нужно, чтобы state не зависел от одной рабочей копии, был доступен команде и защищался блокировкой от одновременных изменений.

## Что настраивается

- [infra/backend.tf](../infra/backend.tf) содержит только пустой блок `backend "s3"`.
- [scripts/infra.mjs](../scripts/infra.mjs) создаёт несекретный partial backend config в `.local/backend.hcl` из переменных окружения и передаёт его в `terraform init`.
- Bucket, key, region, endpoint и настройки совместимости не являются секретами, но всё равно не коммитятся в виде рабочей конфигурации.
- `AWS_ACCESS_KEY_ID` и `AWS_SECRET_ACCESS_KEY` читаются Terraform из окружения. Они не записываются в `backend.hcl`, Git или CI.
- Для state используется отдельный бакет. Он создаётся bootstrap-конфигурацией [infra/bootstrap](../infra/bootstrap) и не является ресурсом основного state, которому нужен при `init`.

Пример параметров backend находится в [infra/backend.hcl.example](../infra/backend.hcl.example). Рабочий файл `.local/backend.hcl` генерируется скриптом и исключён из Git.

## Требования

- Terraform **1.11+**. Нативная блокировка S3 через `use_lockfile` стала общедоступной в Terraform 1.11.
- Включённое версионирование state-бакета: оно позволяет восстановить предыдущую версию state после ошибочной записи.
- S3 static access key сервисного аккаунта, у которого есть доступ к state-бакету (достаточно роли `storage.editor` на этот бакет). Не используйте ключ с правами на всю инфраструктуру, если достаточно доступа к одному бакету.
- Сетевой доступ к `https://storage.yandexcloud.net`.

Yandex Object Storage поддерживает conditional writes в S3 API, поэтому Terraform использует объект `<key>.tflock` рядом с state. Блокировка не отключается: при занятом lockfile второй `plan`/`apply` завершается ошибкой. Скрипты передают `-lock-timeout=5m`, чтобы дождаться короткой конкурирующей операции.

Официальные материалы:

- [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)
- [Yandex Cloud: хранение Terraform state в Object Storage](https://yandex.cloud/ru/docs/tutorials/infrastructure-management/terraform-state-storage)
- [Yandex Cloud: блокировка state](https://yandex.cloud/ru/docs/tutorials/infrastructure-management/terraform-state-lock)
- [Yandex Object Storage: release notes](https://yandex.cloud/ru/docs/storage/release-notes)

В документации YC для старых версий Terraform описан вариант блокировки через Document API YDB (`dynamodb_table`). Начиная с Terraform 1.11 этот способ помечен deprecated. В шаблоне он не используется: нужен дополнительный YDB и совместимый Document API endpoint. Если нативная блокировка недоступна в вашей версии Terraform, обновите Terraform, а не отключайте locking.

## Первый запуск

1. Создайте каталог, deployer-ключ и Telegram-бота, заполните `.env` по [конфигурации](configuration.md). Задайте `TF_STATE_BUCKET` — глобально уникальное имя будущего state-бакета.
2. Создайте state-бакет отдельной bootstrap-конфигурацией:

   ```bash
   npm run infra:bootstrap -- plan
   npm run infra:bootstrap -- apply
   ```

   Bootstrap использует локальный state внутри `infra/bootstrap` и создаёт приватный бакет с версионированием и защитой от удаления. Этот бакет не появится в основном state и не будет удалён командой `reset-folder`. Локальный state bootstrap тоже конфиденциален: сохраните его в защищённом месте или не удаляйте, пока бакет нужен.
3. Создайте S3 static access key для сервисного аккаунта, который будет читать и изменять state-бакет, и задайте его в окружении:

   ```bash
   export AWS_ACCESS_KEY_ID=<state-access-key-id>
   export AWS_SECRET_ACCESS_KEY=<state-secret-access-key>
   ```

   Не добавляйте эти значения в `backend.hcl`, Git, GitHub Actions или `.env.example`. Локальный `.env` допустим только как ваш личный непубликуемый файл с ограниченными правами.
4. Инициализируйте основной backend и проверьте план:

   ```bash
   npm run infra:plan
   ```

   Скрипт создаст `.local/backend.hcl`, выполнит `terraform init`, `fmt -check`, `validate` и `plan`. State будет записан в `s3://$TF_STATE_BUCKET/$TF_STATE_KEY` (по умолчанию ключ содержит `PROJECT_NAME`).
5. Примените план и продолжайте развёртывание по README.

Проверить, что Terraform видит remote state, можно командами:

```bash
terraform -chdir=infra state list
terraform -chdir=infra state pull > /secure/backups/example/terraform.tfstate
```

Для `terraform state pull` нужны те же переменные окружения с ключом доступа и уже выполненный `init` с backend config.

## Миграция существующего локального state

Если раньше проект развёртывался с локальным `infra/terraform.tfstate`:

1. Сделайте внешнюю конфиденциальную копию локального state и `.env`.
2. Убедитесь, что state-бакет создан и `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` заданы.
3. Выполните интерактивную миграцию:

   ```bash
   npm run infra:state:migrate
   ```

   Скрипт вызывает `terraform init -migrate-state -backend-config=...`. Terraform спросит, копировать ли существующий state в S3; подтвердите копирование. Если в S3 уже есть state, не перезаписывайте его вслепую: сначала сравните serial и содержимое.
4. Проверьте `terraform -chdir=infra state list` и `terraform -chdir=infra output`. Только после этого удалите локальный `infra/terraform.tfstate`, если он остался.
5. Запустите `npm run infra:plan` и убедитесь, что план не содержит неожиданного пересоздания ресурсов.

Скрипт `infra:state:migrate` не использует `-force-copy`: решение о копировании остаётся за оператором.

## Резервное копирование и восстановление

`scripts/backup-folder.mjs` больше не копирует локальный `infra/terraform.tfstate`. Он выполняет `terraform state pull` и сохраняет полученный remote state в конфиденциальную внешнюю папку вместе с inventory, deployment outputs, секретами и данными YDB. Папка должна быть вне репозитория, с правами `0700`, файлы — `0600`.

Восстановление state:

1. Остановите все запуски Terraform. Убедитесь, что lockfile не удерживается живым процессом.
2. Скачайте нужную версию state из версионированного state-бакета или возьмите `terraform.tfstate` из проверенной резервной копии.
3. Сравните `serial` и `lineage`. Для отката используйте `terraform state push` только после отдельной копии текущего state. Terraform откажется записывать state с меньшим serial; `-force` применяйте осознанно и только после проверки.
4. Проверьте `terraform plan` перед следующим apply.

Версионирование state-бакета — основной механизм восстановления после ошибочной записи. Lockfile — не резервная копия: не удаляйте его вручную, пока не убедились, что процесс завершился.

## Командная работа

- Все участники используют один bucket/key и собственные S3-ключи с минимальными правами.
- Перед `apply` выполняйте `npm run infra:plan`; не запускайте два apply одновременно.
- Lockfile и `-lock-timeout=5m` защищают state, но не заменяют договорённость о том, кто применяет изменения.
- CI не получает облачные credentials и не выполняет `terraform plan/apply`. GitHub Actions проверяет только typecheck, тесты и сборку.
- State-бакет не удаляется командой `reset-folder`; она сохраняет его и учитывает в `zero-baseline.json`. Перед destructive reset задайте `TF_STATE_SERVICE_ACCOUNT_ID` владельца активного S3-ключа: этот аккаунт и его права тоже сохраняются.
