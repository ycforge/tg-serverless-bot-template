variable "folder_id" {
  type = string
}

variable "service_account_key_file" {
  type = string
}

variable "state_bucket" {
  type = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$", var.state_bucket))
    error_message = "The state bucket name must be 3-63 characters of lowercase letters, digits, dots or hyphens."
  }
}
