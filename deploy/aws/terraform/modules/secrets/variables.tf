variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "managed_secrets" {
  type        = map(string)
  default     = {}
  description = "name => value. Terraform writes the value (e.g. DATABASE_URL, REDIS_URL, MEILISEARCH_API_KEY)."
}

variable "seeded_secrets" {
  type        = list(string)
  default     = []
  description = "Names of secret containers seeded out-of-band; Terraform never manages the value."
}

variable "create_registry_credentials" {
  type    = bool
  default = true
}
