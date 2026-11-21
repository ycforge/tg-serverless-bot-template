locals {
  secret_id         = var.bot_secret_id != "" ? var.bot_secret_id : yandex_lockbox_secret.bot[0].id
  database_id       = var.existing_ydb_id != "" ? var.existing_ydb_id : yandex_ydb_database_serverless.new[0].id
  ydb_cs            = var.existing_ydb_id != "" ? data.yandex_ydb_database_serverless.existing[0].ydb_full_endpoint : yandex_ydb_database_serverless.new[0].ydb_full_endpoint
  runtime_names     = toset(["bot", "api"])
  secret_kms_key_id = var.bot_secret_id != "" ? data.yandex_lockbox_secret.existing[0].kms_key_id : yandex_kms_symmetric_key.bot[0].id
}

resource "yandex_iam_service_account" "invoker" {
  name = "${var.name}-invoker"
}
resource "yandex_iam_service_account" "frontend_reader" {
  name = "${var.name}-frontend-reader"
}
resource "yandex_iam_service_account" "runtime" {
  for_each = local.runtime_names
  name     = "${var.name}-${each.key}-runtime"
}

resource "yandex_kms_symmetric_key" "bot" {
  count               = var.bot_secret_id == "" ? 1 : 0
  name                = "${var.name}-bot-key"
  default_algorithm   = "AES_256"
  deletion_protection = true
}
resource "yandex_lockbox_secret" "bot" {
  count               = var.bot_secret_id == "" ? 1 : 0
  name                = "${var.name}-bot-token"
  deletion_protection = true
  kms_key_id          = yandex_kms_symmetric_key.bot[0].id
}
data "yandex_lockbox_secret" "existing" {
  count     = var.bot_secret_id != "" ? 1 : 0
  secret_id = var.bot_secret_id
}
resource "yandex_kms_symmetric_key_iam_member" "runtime" {
  for_each         = (var.bot_secret_id == "" ? true : local.secret_kms_key_id != "") ? local.runtime_names : toset([])
  symmetric_key_id = local.secret_kms_key_id
  role             = "kms.keys.encrypterDecrypter"
  member           = "serviceAccount:${yandex_iam_service_account.runtime[each.key].id}"
}
resource "yandex_lockbox_secret_iam_member" "runtime" {
  for_each  = local.runtime_names
  secret_id = local.secret_id
  role      = "lockbox.payloadViewer"
  member    = "serviceAccount:${yandex_iam_service_account.runtime[each.key].id}"
}

data "yandex_ydb_database_serverless" "existing" {
  count       = var.existing_ydb_id != "" ? 1 : 0
  database_id = var.existing_ydb_id
}
resource "yandex_ydb_database_serverless" "new" {
  count               = var.existing_ydb_id == "" ? 1 : 0
  name                = "${var.name}-db"
  deletion_protection = true
}
resource "yandex_ydb_database_iam_member" "api" {
  database_id = local.database_id
  role        = "ydb.editor"
  member      = "serviceAccount:${yandex_iam_service_account.runtime["api"].id}"
}

# Terraform owns function identities, not application versions. The provider
# requires an initial version, so create a nonfunctional bootstrap once.
data "archive_file" "bootstrap" {
  type        = "zip"
  source_file = "${path.module}/bootstrap.js"
  output_path = "${path.module}/../.local/bootstrap.zip"
}
resource "yandex_function" "app" {
  for_each           = local.runtime_names
  name               = "${var.name}-${each.key}"
  user_hash          = data.archive_file.bootstrap.output_base64sha256
  runtime            = "nodejs22"
  entrypoint         = "bootstrap.handler"
  memory             = 256
  execution_timeout  = "30"
  service_account_id = yandex_iam_service_account.runtime[each.key].id
  content { zip_filename = data.archive_file.bootstrap.output_path }
  lifecycle {
    ignore_changes = [user_hash, runtime, entrypoint, memory, execution_timeout, content, environment, secrets, service_account_id, tags]
  }
}
resource "yandex_function_iam_binding" "invoke" {
  for_each    = local.runtime_names
  function_id = yandex_function.app[each.key].id
  role        = "functions.functionInvoker"
  members     = ["serviceAccount:${yandex_iam_service_account.invoker.id}"]
}

resource "yandex_storage_bucket" "frontend" {
  bucket        = "${var.name}-${var.folder_id}"
  folder_id     = var.folder_id
  force_destroy = false
  max_size      = 1073741824
  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }
}
resource "yandex_storage_bucket_iam_binding" "frontend_read" {
  bucket  = yandex_storage_bucket.frontend.id
  role    = "storage.viewer"
  members = ["serviceAccount:${yandex_iam_service_account.frontend_reader.id}"]
}

resource "yandex_api_gateway" "tma" {
  name = "${var.name}-tma"
  spec = templatefile("${path.module}/gateway.yaml.tftpl", {
    bucket             = yandex_storage_bucket.frontend.bucket
    api_function_id    = yandex_function.app["api"].id
    invoker_id         = yandex_iam_service_account.invoker.id
    frontend_reader_id = yandex_iam_service_account.frontend_reader.id
  })
  depends_on = [yandex_function_iam_binding.invoke, yandex_storage_bucket_iam_binding.frontend_read]
}
