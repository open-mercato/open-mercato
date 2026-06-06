variable "name_prefix" {
  type        = string
  description = "Resource name prefix, e.g. om-prod. Must be DNS-safe (lowercase, hyphens)."
}

variable "environment" {
  type        = string
  description = "Environment name (dev | staging | prod). Used for tagging."
}

variable "region" {
  type        = string
  description = "AWS region."
}

variable "tags" {
  type        = map(string)
  default     = {}
  description = "Additional tags applied to every resource."
}

variable "deployment_profile" {
  type        = string
  description = "economy (single all-in-one task, single NAT, min data tiers) or scale (HA, dedicated worker service)."
  validation {
    condition     = contains(["economy", "scale"], var.deployment_profile)
    error_message = "deployment_profile must be either \"economy\" or \"scale\"."
  }
}

variable "app_url" {
  type        = string
  description = "Public base URL of the app, e.g. https://app.example.com. Used for APP_URL."
}

variable "certificate_arn" {
  type        = string
  default     = ""
  description = "ACM certificate ARN for the HTTPS listener. If empty, the ALB serves plain HTTP:80 (dev only)."
}

variable "image" {
  type        = string
  description = "Full GHCR image ref for the app, e.g. ghcr.io/open-mercato/open-mercato:prod-abc1234."
}

variable "meili_image" {
  type        = string
  default     = "getmeili/meilisearch:v1.10"
  description = "Meilisearch container image."
}

variable "s3_bucket_name" {
  type        = string
  description = "Globally-unique S3 bucket name for app file storage."
}

variable "health_check_path" {
  type        = string
  default     = "/"
  description = "ALB target-group health-check path for the web service."
}

variable "alarm_email" {
  type        = string
  default     = ""
  description = "Optional email address subscribed to the CloudWatch alarm SNS topic."
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  type        = list(string)
  default     = []
  description = "Availability zones. If empty, the first two AZs of the region are used."
}

variable "public_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.0.0/24", "10.0.1.0/24"]
}

variable "private_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.10.0/24", "10.0.11.0/24"]
}

variable "isolated_subnet_cidrs" {
  type    = list(string)
  default = ["10.0.20.0/24", "10.0.21.0/24"]
}

variable "extra_app_environment" {
  type        = map(string)
  default     = {}
  description = "Additional plain (non-secret) env vars merged into the app container environment."
}

variable "extra_seeded_secrets" {
  type        = list(string)
  default     = []
  description = "Additional secret container names seeded out-of-band (e.g. ANTHROPIC_API_KEY) and injected into the app."
}

# ---- Optional sizing overrides (null => derive from deployment_profile) ----
variable "web_cpu" {
  type    = number
  default = null
}
variable "web_memory" {
  type    = number
  default = null
}
variable "web_desired_count" {
  type    = number
  default = null
}
variable "db_min_acu" {
  type    = number
  default = null
}
variable "db_max_acu" {
  type    = number
  default = null
}
variable "redis_node_type" {
  type    = string
  default = null
}
