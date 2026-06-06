resource "random_password" "auth" {
  # ElastiCache AUTH token: 16-128 chars, alphanumeric only.
  length  = 48
  special = false
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.isolated_subnet_ids
  tags       = merge(var.tags, { Name = "${var.name_prefix}-redis" })
}

resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = substr("${var.name_prefix}-redis", 0, 40)
  description                = "Open Mercato cache/queue/events"
  engine                     = "redis"
  engine_version             = var.engine_version
  node_type                  = var.node_type
  num_cache_clusters         = 1 + var.replicas
  automatic_failover_enabled = var.replicas > 0
  multi_az_enabled           = var.multi_az
  subnet_group_name          = aws_elasticache_subnet_group.this.name
  security_group_ids         = [var.redis_sg_id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.auth.result
  port                       = 6379
  apply_immediately          = true

  tags = merge(var.tags, { Name = "${var.name_prefix}-redis" })
}
