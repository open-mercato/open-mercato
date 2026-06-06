variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "isolated_subnet_ids" {
  type = list(string)
}

variable "aurora_sg_id" {
  type = string
}

variable "engine_version" {
  type    = string
  default = "16.4"
}

variable "min_acu" {
  type    = number
  default = 0.5
}

variable "max_acu" {
  type    = number
  default = 4
}

variable "instance_count" {
  type    = number
  default = 1
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "backup_retention_days" {
  type    = number
  default = 7
}

variable "db_name" {
  type    = string
  default = "open_mercato"
}

variable "master_username" {
  type    = string
  default = "mercato_admin"
}

variable "performance_insights" {
  type    = bool
  default = false
}
