output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}

output "family" {
  value = local.family
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.this.name
}
