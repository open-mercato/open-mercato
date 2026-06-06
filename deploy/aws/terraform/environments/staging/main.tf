terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = {
      Project     = "open-mercato"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

module "stack" {
  source = "../../modules/stack"

  name_prefix        = var.name_prefix
  environment        = var.environment
  region             = var.region
  deployment_profile = var.deployment_profile
  app_url            = var.app_url
  certificate_arn    = var.certificate_arn
  image              = var.image
  s3_bucket_name     = var.s3_bucket_name
  alarm_email        = var.alarm_email
  azs                = var.azs
}

output "alb_dns_name" {
  value = module.stack.alb_dns_name
}

output "cluster_name" {
  value = module.stack.cluster_name
}

output "name_prefix" {
  value = module.stack.name_prefix
}

output "web_service_name" {
  value = module.stack.web_service_name
}

output "worker_service_name" {
  value = module.stack.worker_service_name
}

output "migration_task_family" {
  value = module.stack.migration_task_family
}

output "private_subnet_ids" {
  value = module.stack.private_subnet_ids
}

output "ecs_tasks_security_group_id" {
  value = module.stack.ecs_tasks_security_group_id
}

output "registry_credentials_secret_arn" {
  value = module.stack.registry_credentials_secret_arn
}

output "seeded_secret_arns" {
  value = module.stack.seeded_secret_arns
}
