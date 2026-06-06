variable "region" {
  type = string
}

variable "state_bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for Terraform remote state."
}

variable "lock_table_name" {
  type    = string
  default = "open-mercato-tf-locks"
}

variable "tags" {
  type    = map(string)
  default = {}
}
