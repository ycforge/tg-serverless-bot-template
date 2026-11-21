provider "yandex" {
  folder_id                = var.folder_id
  service_account_key_file = var.service_account_key_file
  endpoint                 = "passthrough:///api.cloud.yandex.net:443"
}

resource "yandex_storage_bucket" "state" {
  bucket        = var.state_bucket
  folder_id     = var.folder_id
  force_destroy = false
  max_size      = 1073741824

  versioning {
    enabled = true
  }

  anonymous_access_flags {
    read        = false
    list        = false
    config_read = false
  }

  lifecycle {
    prevent_destroy = true
  }
}
