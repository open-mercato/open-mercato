data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  is_scale = var.deployment_profile == "scale"

  azs = length(var.azs) > 0 ? var.azs : slice(data.aws_availability_zones.available.names, 0, 2)

  common_tags = merge(var.tags, {
    Project     = "open-mercato"
    Environment = var.environment
    ManagedBy   = "terraform"
  })

  # Profile-derived sizing (overridable via input vars).
  web_cpu           = coalesce(var.web_cpu, local.is_scale ? 2048 : 1024)
  web_memory        = coalesce(var.web_memory, local.is_scale ? 4096 : 2048)
  web_desired_count = coalesce(var.web_desired_count, local.is_scale ? 2 : 1)
  db_min_acu        = coalesce(var.db_min_acu, local.is_scale ? 2 : 0.5)
  db_max_acu        = coalesce(var.db_max_acu, local.is_scale ? 8 : 2)
  redis_node_type   = coalesce(var.redis_node_type, local.is_scale ? "cache.r7g.large" : "cache.t4g.micro")

  db_instance_count = local.is_scale ? 2 : 1
  redis_replicas    = local.is_scale ? 1 : 0
  worker_count      = local.is_scale ? 1 : 0

  # In economy the single task spawns workers + scheduler in-process; in scale a
  # dedicated worker service runs them so the web tasks stay stateless.
  auto_spawn = local.is_scale ? "false" : "true"

  meili_host = "http://meilisearch.${var.name_prefix}.internal:7700"

  # Composed connection URLs (carry credentials; live only in encrypted secrets + state).
  database_url = "postgres://${module.database.master_username}:${module.database.master_password}@${module.database.cluster_endpoint}:${module.database.port}/${module.database.db_name}?sslmode=require"
  redis_url    = "rediss://:${module.cache.auth_token}@${module.cache.primary_endpoint}:${module.cache.port}"

  managed_secrets = {
    DATABASE_URL          = local.database_url
    REDIS_URL             = local.redis_url
    MEILISEARCH_API_KEY   = random_password.meili_key.result
  }

  seeded_secrets = concat([
    "JWT_SECRET",
    "AUTH_SECRET",
    "TENANT_DATA_ENCRYPTION_FALLBACK_KEY",
  ], var.extra_seeded_secrets)

  # Plain (non-secret) env shared by web and worker tasks.
  app_environment = merge({
    NODE_ENV                              = "production"
    PORT                                  = "3000"
    NEXT_TELEMETRY_DISABLED               = "1"
    APP_URL                               = var.app_url
    NEXT_PUBLIC_APP_URL                   = var.app_url
    CACHE_STRATEGY                        = "redis"
    QUEUE_STRATEGY                        = "async"
    RATE_LIMIT_STRATEGY                   = "redis"
    RATE_LIMIT_TRUST_PROXY_DEPTH          = "1"
    DB_SSL                                = "true"
    OM_SEARCH_ENABLED                     = "true"
    MEILISEARCH_HOST                      = local.meili_host
    OM_ENABLE_STORAGE_S3                  = "true"
    OM_INTEGRATION_STORAGE_S3_REGION      = var.region
    OM_INTEGRATION_STORAGE_S3_BUCKET      = var.s3_bucket_name
    OM_INTEGRATION_STORAGE_S3_FORCE_PATH_STYLE = "false"
  }, var.extra_app_environment)

  # env-var name => secret ARN, for both web and worker.
  app_secret_refs = {
    for name in keys(module.secrets.secret_arns) : name => module.secrets.secret_arns[name]
  }
}

resource "random_password" "meili_key" {
  length  = 48
  special = false
}

module "network" {
  source = "../network"

  name_prefix                = var.name_prefix
  tags                       = local.common_tags
  vpc_cidr                   = var.vpc_cidr
  azs                        = local.azs
  public_subnet_cidrs        = var.public_subnet_cidrs
  private_subnet_cidrs       = var.private_subnet_cidrs
  isolated_subnet_cidrs      = var.isolated_subnet_cidrs
  single_nat_gateway         = !local.is_scale
  enable_interface_endpoints = true
  region                     = var.region
  container_port             = 3000
}

module "database" {
  source = "../database"

  name_prefix          = var.name_prefix
  tags                 = local.common_tags
  isolated_subnet_ids  = module.network.isolated_subnet_ids
  aurora_sg_id         = module.network.aurora_sg_id
  min_acu              = local.db_min_acu
  max_acu              = local.db_max_acu
  instance_count       = local.db_instance_count
  deletion_protection  = local.is_scale
  backup_retention_days = local.is_scale ? 14 : 7
  performance_insights = local.is_scale
}

module "cache" {
  source = "../cache"

  name_prefix         = var.name_prefix
  tags                = local.common_tags
  isolated_subnet_ids = module.network.isolated_subnet_ids
  redis_sg_id         = module.network.redis_sg_id
  node_type           = local.redis_node_type
  replicas            = local.redis_replicas
  multi_az            = local.is_scale
}

module "storage" {
  source = "../storage"

  name_prefix  = var.name_prefix
  tags         = local.common_tags
  bucket_name  = var.s3_bucket_name
  force_destroy = !local.is_scale
}

module "secrets" {
  source = "../secrets"

  name_prefix                 = var.name_prefix
  tags                        = local.common_tags
  managed_secrets             = local.managed_secrets
  seeded_secrets              = local.seeded_secrets
  create_registry_credentials = true
}

module "ecs_cluster" {
  source = "../ecs-cluster"

  name_prefix              = var.name_prefix
  tags                     = local.common_tags
  vpc_id                   = module.network.vpc_id
  public_subnet_ids        = module.network.public_subnet_ids
  alb_sg_id                = module.network.alb_sg_id
  container_port           = 3000
  health_check_path        = var.health_check_path
  certificate_arn          = var.certificate_arn
  enable_container_insights = true
  execution_secret_arns    = module.secrets.all_secret_arns
  task_s3_policy_json       = module.storage.access_policy_json
}

# EFS for Meilisearch index persistence.
resource "aws_efs_file_system" "meili" {
  encrypted        = true
  throughput_mode  = "elastic"
  performance_mode = "generalPurpose"
  tags             = merge(local.common_tags, { Name = "${var.name_prefix}-meili" })
}

resource "aws_efs_mount_target" "meili" {
  count           = length(module.network.isolated_subnet_ids)
  file_system_id  = aws_efs_file_system.meili.id
  subnet_id       = module.network.isolated_subnet_ids[count.index]
  security_groups = [module.network.efs_sg_id]
}

resource "aws_efs_access_point" "meili" {
  file_system_id = aws_efs_file_system.meili.id
  posix_user {
    uid = 1000
    gid = 1000
  }
  root_directory {
    path = "/meili"
    creation_info {
      owner_uid   = 1000
      owner_gid   = 1000
      permissions = "0755"
    }
  }
  tags = merge(local.common_tags, { Name = "${var.name_prefix}-meili-ap" })
}

module "meilisearch" {
  source = "../app-service"

  name_prefix       = var.name_prefix
  tags              = local.common_tags
  region            = var.region
  service_name      = "meilisearch"
  cluster_arn       = module.ecs_cluster.cluster_arn
  cluster_name      = module.ecs_cluster.cluster_name
  image             = var.meili_image
  container_port    = 7700
  cpu               = local.is_scale ? 1024 : 512
  memory            = local.is_scale ? 2048 : 1024
  desired_count     = 1
  environment = {
    MEILI_ENV          = "production"
    MEILI_NO_ANALYTICS = "true"
    MEILI_DB_PATH      = "/meili_data"
  }
  secrets = {
    MEILI_MASTER_KEY = module.secrets.secret_arns["MEILISEARCH_API_KEY"]
  }
  execution_role_arn = module.ecs_cluster.execution_role_arn
  task_role_arn      = module.ecs_cluster.task_role_arn
  subnet_ids         = module.network.private_subnet_ids
  security_group_ids = [module.network.meili_sg_id]

  service_discovery_namespace_id = module.ecs_cluster.namespace_id

  efs_file_system_id  = aws_efs_file_system.meili.id
  efs_access_point_id = aws_efs_access_point.meili.id
  efs_container_path  = "/meili_data"

  circuit_breaker = false
}

module "web" {
  source = "../app-service"

  name_prefix       = var.name_prefix
  tags              = local.common_tags
  region            = var.region
  service_name      = "web"
  cluster_arn       = module.ecs_cluster.cluster_arn
  cluster_name      = module.ecs_cluster.cluster_name
  image             = var.image
  command           = [] # use the runner image default CMD (`yarn start`)
  container_port    = 3000
  cpu               = local.web_cpu
  memory            = local.web_memory
  desired_count     = local.web_desired_count
  environment = merge(local.app_environment, {
    AUTO_SPAWN_WORKERS   = local.auto_spawn
    AUTO_SPAWN_SCHEDULER = local.auto_spawn
  })
  secrets                     = local.app_secret_refs
  execution_role_arn          = module.ecs_cluster.execution_role_arn
  task_role_arn               = module.ecs_cluster.task_role_arn
  subnet_ids                  = module.network.private_subnet_ids
  security_group_ids          = [module.network.ecs_tasks_sg_id]
  target_group_arn            = module.ecs_cluster.target_group_arn
  repository_credentials_arn  = module.secrets.registry_credentials_arn
  health_check_grace_period   = 120

  autoscaling_min = local.is_scale ? local.web_desired_count : 0
  autoscaling_max = local.is_scale ? 6 : 0
  cpu_target      = 60
}

module "worker" {
  source = "../app-service"
  count  = local.worker_count

  name_prefix    = var.name_prefix
  tags           = local.common_tags
  region         = var.region
  service_name   = "worker"
  cluster_arn    = module.ecs_cluster.cluster_arn
  cluster_name   = module.ecs_cluster.cluster_name
  image          = var.image
  command        = ["yarn", "mercato", "queue", "worker", "--all"]
  container_port = 3000
  cpu            = 1024
  memory         = 2048
  desired_count  = 2
  environment = merge(local.app_environment, {
    AUTO_SPAWN_WORKERS   = "false"
    AUTO_SPAWN_SCHEDULER = "false"
  })
  secrets                    = local.app_secret_refs
  execution_role_arn         = module.ecs_cluster.execution_role_arn
  task_role_arn              = module.ecs_cluster.task_role_arn
  subnet_ids                 = module.network.private_subnet_ids
  security_group_ids         = [module.network.ecs_tasks_sg_id]
  target_group_arn           = "" # no load balancer for workers
  repository_credentials_arn = module.secrets.registry_credentials_arn

  autoscaling_min = 2
  autoscaling_max = 6
  cpu_target      = 65
}

module "migration" {
  source = "../migration-task"

  name_prefix                = var.name_prefix
  tags                       = local.common_tags
  region                     = var.region
  image                      = var.image
  command                    = ["yarn", "mercato", "db", "migrate"]
  environment                = local.app_environment
  secrets                    = local.app_secret_refs
  execution_role_arn         = module.ecs_cluster.execution_role_arn
  task_role_arn              = module.ecs_cluster.task_role_arn
  repository_credentials_arn = module.secrets.registry_credentials_arn
}

module "observability" {
  source = "../observability"

  name_prefix                = var.name_prefix
  tags                       = local.common_tags
  alarm_email                = var.alarm_email
  alb_arn_suffix             = module.ecs_cluster.alb_arn_suffix
  target_group_arn_suffix    = module.ecs_cluster.target_group_arn_suffix
  cluster_name               = module.ecs_cluster.cluster_name
  web_service_name           = module.web.service_name
  db_cluster_identifier      = module.database.cluster_identifier
  redis_replication_group_id = module.cache.replication_group_id
}
