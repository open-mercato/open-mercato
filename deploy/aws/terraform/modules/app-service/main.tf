locals {
  has_target_group     = var.target_group_arn != ""
  has_service_registry = var.service_discovery_namespace_id != ""
  has_efs              = var.efs_file_system_id != ""

  container_definition = jsonencode([
    {
      name      = var.service_name
      image     = var.image
      essential = true
      command   = length(var.command) > 0 ? var.command : null

      portMappings = local.has_target_group ? [
        {
          containerPort = var.container_port
          protocol      = "tcp"
        }
      ] : []

      environment = [for k, v in var.environment : { name = k, value = v }]
      secrets     = [for k, v in var.secrets : { name = k, valueFrom = v }]

      repositoryCredentials = var.repository_credentials_arn != "" ? {
        credentialsParameter = var.repository_credentials_arn
      } : null

      mountPoints = local.has_efs ? [
        {
          sourceVolume  = "data"
          containerPath = var.efs_container_path
          readOnly      = false
        }
      ] : []

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.this.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = var.service_name
        }
      }
    }
  ])
}

resource "aws_cloudwatch_log_group" "this" {
  name              = "${var.name_prefix}-${var.service_name}"
  retention_in_days = var.log_retention_days

  tags = merge(var.tags, { Name = "${var.name_prefix}-${var.service_name}" })
}

resource "aws_ecs_task_definition" "this" {
  family                   = "${var.name_prefix}-${var.service_name}"
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

  dynamic "volume" {
    for_each = local.has_efs ? [1] : []

    content {
      name = "data"

      efs_volume_configuration {
        file_system_id     = var.efs_file_system_id
        transit_encryption = "ENABLED"

        authorization_config {
          access_point_id = var.efs_access_point_id
          iam             = "DISABLED"
        }
      }
    }
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-${var.service_name}" })
}

resource "aws_service_discovery_service" "this" {
  count = local.has_service_registry ? 1 : 0

  name = var.service_name

  dns_config {
    namespace_id = var.service_discovery_namespace_id

    dns_records {
      ttl  = 10
      type = "A"
    }

    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-${var.service_name}-sd" })
}

resource "aws_ecs_service" "this" {
  name            = var.service_name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  enable_execute_command = var.enable_execute_command

  health_check_grace_period_seconds = local.has_target_group ? var.health_check_grace_period : null

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = var.assign_public_ip
  }

  deployment_circuit_breaker {
    enable   = var.circuit_breaker
    rollback = var.circuit_breaker
  }

  dynamic "load_balancer" {
    for_each = local.has_target_group ? [1] : []

    content {
      target_group_arn = var.target_group_arn
      container_name   = var.service_name
      container_port   = var.container_port
    }
  }

  dynamic "service_registries" {
    for_each = local.has_service_registry ? [1] : []

    content {
      registry_arn = aws_service_discovery_service.this[0].arn
    }
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-${var.service_name}" })
}

resource "aws_appautoscaling_target" "this" {
  count = var.autoscaling_max > 0 ? 1 : 0

  min_capacity       = var.autoscaling_min
  max_capacity       = var.autoscaling_max
  resource_id        = "service/${var.cluster_name}/${var.service_name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"

  depends_on = [aws_ecs_service.this]
}

resource "aws_appautoscaling_policy" "cpu" {
  count = var.autoscaling_max > 0 ? 1 : 0

  name               = "${var.name_prefix}-${var.service_name}-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.this[0].resource_id
  scalable_dimension = aws_appautoscaling_target.this[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.this[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }

    target_value = var.cpu_target
  }
}
