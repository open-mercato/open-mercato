variable "name_prefix" {
  type = string
}

variable "tags" {
  type    = map(string)
  default = {}
}

variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "alb_sg_id" {
  type = string
}

variable "container_port" {
  type    = number
  default = 3000
}

variable "health_check_path" {
  type    = string
  default = "/"
}

variable "certificate_arn" {
  type    = string
  default = ""
}

variable "enable_container_insights" {
  type    = bool
  default = true
}

variable "idle_timeout" {
  type    = number
  default = 120
}

variable "ssl_policy" {
  type    = string
  default = "ELBSecurityPolicy-TLS13-1-2-2021-06"
}

variable "execution_secret_arns" {
  type    = list(string)
  default = []
}

variable "task_s3_policy_json" {
  type    = string
  default = ""
}
