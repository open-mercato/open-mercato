locals {
  family = "${var.name_prefix}-migrate"

  container_definition = jsonencode([
    {
      name      = "migrate"
      image     = var.image
      essential = true
      command   = length(var.command) > 0 ? var.command : null

      environment = [for k, v in var.environment : { name = k, value = v }]
      secrets     = [for k, v in var.secrets : { name = k, valueFrom = v }]

      repositoryCredentials = var.repository_credentials_arn != "" ? {
        credentialsParameter = var.repository_credentials_arn
      } : null

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}

resource "aws_cloudwatch_log_group" "this" {
  name              = local.family
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, { Name = local.family })
}

resource "aws_ecs_task_definition" "this" {
  family                   = local.family
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.cpu)
  memory                   = tostring(var.memory)
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions    = local.container_definition

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  tags = merge(var.tags, { Name = local.family })
}
