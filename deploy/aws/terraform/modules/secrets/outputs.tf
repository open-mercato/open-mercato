locals {
  managed_arns = { for k, s in aws_secretsmanager_secret.managed : k => s.arn }
  seeded_arns  = { for k, s in aws_secretsmanager_secret.seeded : k => s.arn }
  registry_arn = var.create_registry_credentials ? aws_secretsmanager_secret.registry[0].arn : ""
}

output "secret_arns" {
  value       = merge(local.managed_arns, local.seeded_arns)
  description = "logical name => secret ARN (managed + seeded)."
}

output "registry_credentials_arn" {
  value = local.registry_arn
}

output "all_secret_arns" {
  value = concat(
    values(local.managed_arns),
    values(local.seeded_arns),
    var.create_registry_credentials ? [local.registry_arn] : []
  )
  description = "Every secret ARN the ECS execution role must be allowed to read."
}
