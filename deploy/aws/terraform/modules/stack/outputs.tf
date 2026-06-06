output "alb_dns_name" {
  value       = module.ecs_cluster.alb_dns_name
  description = "Public DNS name of the ALB. Point your app domain (CNAME/ALIAS) at this."
}

output "alb_zone_id" {
  value       = module.ecs_cluster.alb_zone_id
  description = "ALB hosted-zone ID for Route 53 alias records."
}

output "cluster_name" {
  value = module.ecs_cluster.cluster_name
}

output "name_prefix" {
  value = var.name_prefix
}

output "web_service_name" {
  value = module.web.service_name
}

output "worker_service_name" {
  value       = local.worker_count > 0 ? module.worker[0].service_name : ""
  description = "Worker ECS service name (empty in the economy profile)."
}

output "migration_task_family" {
  value       = module.migration.family
  description = "ECS task-definition family for the one-off migration/init task."
}

output "private_subnet_ids" {
  value = module.network.private_subnet_ids
}

output "ecs_tasks_security_group_id" {
  value = module.network.ecs_tasks_sg_id
}

output "database_endpoint" {
  value = module.database.cluster_endpoint
}

output "redis_primary_endpoint" {
  value = module.cache.primary_endpoint
}

output "s3_bucket_name" {
  value = module.storage.bucket_name
}

output "registry_credentials_secret_arn" {
  value       = module.secrets.registry_credentials_arn
  description = "Seed this with {username, password=GHCR PAT} before the first deploy."
}

output "seeded_secret_arns" {
  value       = { for name in local.seeded_secrets : name => module.secrets.secret_arns[name] }
  description = "Secrets that must be populated out-of-band via deploy/aws/scripts/seed-secrets.sh."
}

output "alarms_sns_topic_arn" {
  value = module.observability.sns_topic_arn
}
