# Secrets whose VALUE Terraform manages (composed URLs, generated keys).
resource "aws_secretsmanager_secret" "managed" {
  for_each = var.managed_secrets
  name     = "${var.name_prefix}/${each.key}"
  tags     = merge(var.tags, { Name = "${var.name_prefix}/${each.key}" })
}

resource "aws_secretsmanager_secret_version" "managed" {
  for_each      = var.managed_secrets
  secret_id     = aws_secretsmanager_secret.managed[each.key].id
  secret_string = each.value
}

# Secrets seeded out-of-band: Terraform creates the container + a placeholder, then
# ignores the value so operators overwrite it via the AWS CLI / seed-secrets.sh.
resource "aws_secretsmanager_secret" "seeded" {
  for_each = toset(var.seeded_secrets)
  name     = "${var.name_prefix}/${each.value}"
  tags     = merge(var.tags, { Name = "${var.name_prefix}/${each.value}" })
}

resource "aws_secretsmanager_secret_version" "seeded" {
  for_each      = toset(var.seeded_secrets)
  secret_id     = aws_secretsmanager_secret.seeded[each.value].id
  secret_string = "PLACEHOLDER-SEED-VIA-CLI"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# GHCR pull credentials for ECS repositoryCredentials.
resource "aws_secretsmanager_secret" "registry" {
  count = var.create_registry_credentials ? 1 : 0
  name  = "${var.name_prefix}/ghcr-pull"
  tags  = merge(var.tags, { Name = "${var.name_prefix}/ghcr-pull" })
}

resource "aws_secretsmanager_secret_version" "registry" {
  count         = var.create_registry_credentials ? 1 : 0
  secret_id     = aws_secretsmanager_secret.registry[0].id
  secret_string = jsonencode({ username = "REPLACE", password = "REPLACE" })

  lifecycle {
    ignore_changes = [secret_string]
  }
}
