output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}

output "service_discovery_arn" {
  value = local.has_service_registry ? aws_service_discovery_service.this[0].arn : ""
}
