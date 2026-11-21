terraform {
  required_version = ">= 1.5"
  required_providers {
    yandex  = { source = "yandex-cloud/yandex", version = "~> 0.235.0" }
    archive = { source = "hashicorp/archive", version = "~> 2.7" }
  }
}
provider "yandex" {
  folder_id                = var.folder_id
  service_account_key_file = var.service_account_key_file
  endpoint                 = "passthrough:///api.cloud.yandex.net:443"
}
