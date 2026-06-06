variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "region" {
  type = string
}

variable "service_name" {
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "cluster_name" {
  type = string
}

variable "image" {
  type = string
}

variable "command" {
  type    = list(string)
  default = []
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "cpu" {
  type    = number
  default = 1024
}

variable "memory" {
  type    = number
  default = 2048
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  type    = map(string)
  default = {}
}

variable "execution_role_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "assign_public_ip" {
  type    = bool
  default = false
}

variable "target_group_arn" {
  type    = string
  default = ""
}

variable "repository_credentials_arn" {
  type    = string
  default = ""
}

variable "enable_execute_command" {
  type    = bool
  default = true
}

variable "circuit_breaker" {
  type    = bool
  default = true
}

variable "health_check_grace_period" {
  type    = number
  default = 0
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "autoscaling_min" {
  type    = number
  default = 0
}

variable "autoscaling_max" {
  type    = number
  default = 0
}

variable "cpu_target" {
  type    = number
  default = 60
}

variable "service_discovery_namespace_id" {
  type    = string
  default = ""
}

variable "efs_file_system_id" {
  type    = string
  default = ""
}

variable "efs_access_point_id" {
  type    = string
  default = ""
}

variable "efs_container_path" {
  type    = string
  default = ""
}
