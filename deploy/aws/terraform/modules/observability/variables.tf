variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "alarm_email" {
  type    = string
  default = ""
}

variable "alb_arn_suffix" {
  type = string
}

variable "target_group_arn_suffix" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "web_service_name" {
  type = string
}

variable "db_cluster_identifier" {
  type = string
}

variable "redis_replication_group_id" {
  type = string
}
