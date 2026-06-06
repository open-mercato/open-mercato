variable "region" {
  type    = string
  default = "us-east-1"
}

variable "name_prefix" {
  type        = string
  default     = "om-dev"
  description = "Keep short (<= 28 chars) — ALB/target-group names are derived from it."
}

variable "environment" {
  type    = string
  default = "dev"
}

variable "deployment_profile" {
  type    = string
  default = "economy"
}

variable "app_url" {
  type = string
}

variable "certificate_arn" {
  type    = string
  default = ""
}

variable "image" {
  type        = string
  description = "GHCR image ref, e.g. ghcr.io/open-mercato/open-mercato:prod-abc1234"
}

variable "s3_bucket_name" {
  type = string
}

variable "alarm_email" {
  type    = string
  default = ""
}

variable "azs" {
  type    = list(string)
  default = []
}
