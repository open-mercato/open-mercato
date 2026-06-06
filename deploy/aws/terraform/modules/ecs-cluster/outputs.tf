output "cluster_arn" {
  value = aws_ecs_cluster.this.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "alb_arn" {
  value = aws_lb.this.arn
}

output "alb_dns_name" {
  value = aws_lb.this.dns_name
}

output "alb_zone_id" {
  value = aws_lb.this.zone_id
}

output "alb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}

output "target_group_arn" {
  value = aws_lb_target_group.web.arn
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.web.arn_suffix
}

output "https_listener_arn" {
  value = local.has_certificate ? aws_lb_listener.https[0].arn : ""
}

output "namespace_id" {
  value = aws_service_discovery_private_dns_namespace.internal.id
}

output "namespace_arn" {
  value = aws_service_discovery_private_dns_namespace.internal.arn
}

output "execution_role_arn" {
  value = aws_iam_role.execution.arn
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}
