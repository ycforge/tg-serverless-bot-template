output "deployment" {
  value = {
    folder_id         = var.folder_id
    bot_function_id   = yandex_function.app["bot"].id
    api_function_id   = yandex_function.app["api"].id
    invoker_sa_id     = yandex_iam_service_account.invoker.id
    bot_runtime_sa_id = yandex_iam_service_account.runtime["bot"].id
    api_runtime_sa_id = yandex_iam_service_account.runtime["api"].id
    secret_id         = local.secret_id
    database_id       = local.database_id
    ydb_cs            = local.ydb_cs
    bucket            = yandex_storage_bucket.frontend.bucket
    tma_url           = "https://${yandex_api_gateway.tma.domain}/"
  }
}
