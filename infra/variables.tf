variable "folder_id" { type = string }
variable "service_account_key_file" { type = string }
variable "name" {
  type    = string
  default = "tg-serverless-example"
}
variable "existing_ydb_id" {
  type    = string
  default = ""
}
variable "bot_secret_id" {
  type        = string
  description = "Existing Lockbox secret ID, or empty to create a secret container. Payload is always managed outside Terraform."
  default     = ""
}
