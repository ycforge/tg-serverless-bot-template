output "state_bucket" {
  value = yandex_storage_bucket.state.bucket
}

output "state_endpoint" {
  value = "https://storage.yandexcloud.net"
}
