resource "random_password" "master" {
  length  = 32
  special = true
  # URL-safe subset: avoid / @ : ? # & which would break the composed DATABASE_URL.
  override_special = "!#%*-_=+"
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.name_prefix}-aurora"
  subnet_ids = var.isolated_subnet_ids
  tags       = merge(var.tags, { Name = "${var.name_prefix}-aurora" })
}

resource "aws_rds_cluster_parameter_group" "this" {
  name        = "${var.name_prefix}-aurora-pg16"
  family      = "aurora-postgresql16"
  description = "Open Mercato Aurora PostgreSQL cluster params"

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "pending-reboot"
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-aurora-pg16" })
}

resource "aws_rds_cluster" "this" {
  cluster_identifier              = "${var.name_prefix}-aurora"
  engine                          = "aurora-postgresql"
  engine_version                  = var.engine_version
  database_name                   = var.db_name
  master_username                 = var.master_username
  master_password                 = random_password.master.result
  db_subnet_group_name            = aws_db_subnet_group.this.name
  vpc_security_group_ids          = [var.aurora_sg_id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name
  storage_encrypted               = true
  backup_retention_period         = var.backup_retention_days
  deletion_protection             = var.deletion_protection
  skip_final_snapshot             = !var.deletion_protection
  final_snapshot_identifier       = var.deletion_protection ? "${var.name_prefix}-aurora-final" : null
  copy_tags_to_snapshot           = true
  iam_database_authentication_enabled = true
  apply_immediately               = true

  serverlessv2_scaling_configuration {
    min_capacity = var.min_acu
    max_capacity = var.max_acu
  }

  tags = merge(var.tags, { Name = "${var.name_prefix}-aurora" })
}

resource "aws_rds_cluster_instance" "this" {
  count                = var.instance_count
  identifier           = "${var.name_prefix}-aurora-${count.index}"
  cluster_identifier   = aws_rds_cluster.this.id
  instance_class       = "db.serverless"
  engine               = aws_rds_cluster.this.engine
  engine_version       = aws_rds_cluster.this.engine_version
  db_subnet_group_name = aws_db_subnet_group.this.name
  performance_insights_enabled = var.performance_insights
  publicly_accessible  = false
  tags                 = merge(var.tags, { Name = "${var.name_prefix}-aurora-${count.index}" })
}
