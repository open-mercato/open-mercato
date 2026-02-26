# SPEC-028: OpenMercato ECS Deployment Foundation for AWS (Terraform Module)


  

**Date:** 2026-02-15

**Status:** Proposal

**Scope:** OpenMercato ECS Deployment Foundation for AWS (Terraform Module)

**Mandatory Delivery Model:** This proposal requires creating and maintaining a new dedicated Terraform repository in the OpenMercato organization for the `openmercato-ecs` module.


  

## Problem Statement

OpenMercato currently lacks a single, opinionated Terraform module that supports enterprise-grade deployment scenarios, particularly for customers operating within their own AWS infrastructure environments.

In enterprise contexts, it is a common industry pattern that customers already operate mature, pre-existing infrastructure on AWS or hybrid environments. This includes centrally managed databases, Redis clusters, networking topologies, and shared platform services that must be reused rather than replaced.

As a result, the deployment module must support flexible integration modes instead of assuming ownership of all dependencies.

Specifically, enterprise deployments require the ability to:

- Deploy OpenMercato into an existing AWS account and existing VPC/network topology without forcing creation of new infrastructure.

- Connect to databases that may be:
  - Managed outside of this Terraform module but within the same AWS account,
  - Hosted in a different AWS account (cross-account architecture),
  - Hosted outside AWS entirely (for example external PostgreSQL providers),
  - Legacy databases that cannot be reprovisioned.

- Connect to cache systems such as Redis that may be:
  - Existing ElastiCache clusters managed independently,
  - Redis deployments running outside AWS,
  - Shared Redis infrastructure used by multiple services.

- Integrate with enterprise-owned networking, DNS, security, and compliance configurations.

Without this flexibility, OpenMercato cannot be deployed into enterprise customer environments, which is a critical requirement for enterprise adoption and platform-hosted deployments.

Additionally, the lack of a standardized module leads to:

- Inconsistent deployment architectures,
- Increased operational risk due to manual infrastructure assembly,
- Slower onboarding of enterprise customers,
- Reduced ability to support platform-hosted deployments where infrastructure ownership boundaries vary.

Therefore, a configurable Terraform module is required to support multiple infrastructure ownership models, including fully managed, partially managed, and externally integrated enterprise deployment modes.

## Proposed Solution

Build a first-party Terraform module called `openmercato-ecs` that provides one clear and reliable way to deploy OpenMercato on AWS ECS/Fargate.

The module will package the core infrastructure components (ECS, ALB, IAM, logging, optional DNS/TLS, and optional WAF) and expose simple mode switches to control what Terraform creates versus what is supplied by the operator.

This allows the same module to work both in greenfield environments (where everything is created from scratch) and in enterprise environments (where networking, databases, or cache systems already exist and must be reused).

This proposal also includes creating a dedicated Terraform repository in the OpenMercato organization to host the module implementation, examples, CI checks, and release/versioning flow for the module.

### Core Approach

- **One module, multiple deployment modes**
  - Operators can choose whether the module creates dependencies like VPC, database, or Redis, or connects to existing ones.

- **Safe defaults and clear validation**
  - The module enforces secure defaults and prevents invalid or ambiguous configurations.

- **Stable and predictable deployment contract**
  - Instead of building custom stacks every time, operators use a consistent, supported deployment interface.

### What This Will Achieve

- **Standardized deployments**
  - All OpenMercato environments follow the same deployment model instead of having slightly different infrastructure per environment.

- **Enterprise compatibility**
  - OpenMercato can be deployed into customer-owned AWS accounts and existing infrastructure without needing to redesign or fork deployment logic.

- **Secure-by-default infrastructure**
  - Tasks run in private subnets, access is restricted through security groups, and sensitive configuration is injected via secrets.

- **Flexible runtime topology**
  - Support both simple deployments and more advanced setups with separate worker services when needed.

- **Faster onboarding of new environments**
  - New environments can be provisioned quickly using predefined module configurations and examples.

- **More predictable operations**
  - Consistent infrastructure reduces configuration drift and lowers the risk of deployment-related issues.


**Scope:**

- ECS cluster, task definitions, web/worker services, ALB, IAM roles, CloudWatch logs, and autoscaling.

- Optional managed PostgreSQL (RDS) or external DB connectivity.

- Optional managed Redis (ElastiCache) or external Redis connectivity.

- Optional Route53 + ACM certificate issuance/validation for custom domains.

- Optional AWS WAF association for ALB.

- Networking per `.ai/specs/ecs-networking.md`, with override mode for user-supplied VPC/subnet IDs.

- Create and maintain a dedicated Terraform module repository in the OpenMercato organization as the delivery artifact for `openmercato-ecs`.

  

### Design Decisions

| Decision | Rationale |
| --- | --- |
| One module with conditional sub-resources | Reduces integration friction for adopters while preserving flexibility |
| Mode-based dependency config (`managed` vs `external`) | Ensures safe mutually exclusive configuration paths |
| Networking mode (`managed` vs `existing`) | Supports secure defaults and advanced custom network topologies |
| Domain mode (`none` vs `route53`) | Supports both ALB-only and full DNS+TLS production usage |
| Runtime mode (`single_service` vs `split_workers`) | Preserves simple default deployment while supporting dedicated worker ECS services |
| Application image as required input | Keeps build/publish concerns outside infra module |
| Same image for web and workers with command overrides | Keeps build pipeline simple while allowing role-specific runtime behavior |
| Async scheduler uses one-shot sync task + worker service processing | Matches OpenMercato scheduler architecture and avoids extra always-on scheduler service in async mode |
| ECS blue/green deployment excluded from scope | Keeps first version operationally simple and predictable |
| Managed Redis supports `replication_group` and `serverless` | Allows cost/performance flexibility per environment and region capabilities |
| WAF supports attaching custom existing Web ACL | Lets security teams manage ACL lifecycle outside this module |
| Dedicated module repository in OpenMercato organization | Enables independent versioning, CI, publishing, and ownership of Terraform artifacts |

  

## User Stories / Use Cases

- **Platform engineer** wants to deploy OpenMercato to ECS with a tagged image so that releases are repeatable.

- **Platform engineer** wants Terraform to create RDS and Redis so that new environments can be bootstrapped quickly.

- **Enterprise operator** wants to provide external DB/Redis endpoints so that shared managed services can be reused.

- **Operator** wants to configure custom domain + HTTPS certificate validation so that the app is reachable via branded DNS securely.

- **Advanced AWS user** wants to provide existing VPC/subnets so that deployment fits a pre-existing network architecture.

- **Platform engineer** wants to scale queue workers independently from the web app so background throughput does not compete with HTTP traffic.

- **Operator** wants to isolate critical queues (e.g., scheduler, events, indexing) into separate ECS services with independent autoscaling.

  

## Architecture

  

### High-Level Topology

Managed networking mode follows `.ai/specs/ecs-networking.md`:

  

Internet -> ALB (public subnets) -> ECS Tasks (private subnets) -> NAT Gateway -> Internet (egress)

  

Application traffic:

- Ingress: ALB listeners (80, optional 443) route to ECS target group.

- ECS tasks run with `awsvpc`, private IPs, and `assign_public_ip = false`.

- Task security group allows inbound only from ALB security group on app port.

  

Dependency traffic:

- ECS tasks connect to PostgreSQL (RDS or external endpoint) and Redis (ElastiCache or external URL).

- Security rules restrict DB/Redis access to ECS task security group where managed resources are created.

  

Runtime topology:

- `runtime_mode = "single_service"`: one ECS service runs the web process (`yarn start`) and may auto-spawn workers/scheduler per env flags.

- `runtime_mode = "split_workers"`: one ALB-backed web ECS service plus one or more private worker ECS services with command overrides (for example `yarn mercato queue worker --all` or per-queue worker commands).

- In split mode, web tasks MUST run app-only (`AUTO_SPAWN_WORKERS=false`, `AUTO_SPAWN_SCHEDULER=false`) and workers MUST use Redis-backed async queues (`QUEUE_STRATEGY=async`).

  

### Module Layout (Proposed)

The following layout is defined for the new dedicated Terraform repository in the OpenMercato organization.

- `infra/terraform/modules/openmercato-ecs/versions.tf`

- `infra/terraform/modules/openmercato-ecs/variables.tf`

- `infra/terraform/modules/openmercato-ecs/locals.tf`

- `infra/terraform/modules/openmercato-ecs/networking.tf`

- `infra/terraform/modules/openmercato-ecs/security_groups.tf`

- `infra/terraform/modules/openmercato-ecs/alb.tf`

- `infra/terraform/modules/openmercato-ecs/ecs.tf`

- `infra/terraform/modules/openmercato-ecs/autoscaling.tf`

- `infra/terraform/modules/openmercato-ecs/iam.tf`

- `infra/terraform/modules/openmercato-ecs/logging.tf`

- `infra/terraform/modules/openmercato-ecs/rds.tf`

- `infra/terraform/modules/openmercato-ecs/elasticache.tf`

- `infra/terraform/modules/openmercato-ecs/dns.tf`

- `infra/terraform/modules/openmercato-ecs/waf.tf`

- `infra/terraform/modules/openmercato-ecs/outputs.tf`

- `infra/terraform/modules/openmercato-ecs/README.md`

- `infra/terraform/examples/minimal-managed/`

- `infra/terraform/examples/external-dependencies/`

- `infra/terraform/examples/existing-network-with-dns/`

### Resource File Boundaries (Required)

The module must avoid a single `main.tf` orchestration file for resource definitions. Resource ownership is split by concern:

- `alb.tf`: ALB, target groups, listeners, listener rules, TLS redirect behavior.

- `rds.tf`: managed PostgreSQL subnet group, parameter/security settings, DB instance.

- `elasticache.tf`: managed Redis subnet group, replication group and/or serverless cache path.

- `waf.tf`: optional WAFv2 Web ACL association for ALB.

- `dns.tf`: ACM certificate, DNS validation records, Route53 alias records.

- `ecs.tf`: ECS cluster, task definitions, web/worker services, scheduler sync task.

- `networking.tf`: managed VPC/subnets/routes/NAT resources and existing-network selectors.

- `security_groups.tf`: ALB, ECS task, DB, Redis security groups and rules.

- `iam.tf`: task execution role, task role, policy attachments.

- `logging.tf`: CloudWatch log groups and retention policy.

- `autoscaling.tf`: ECS service target tracking policies for web/worker services.

- `locals.tf`, `variables.tf`, `outputs.tf`, `versions.tf`: interface and derived values only.

### Reference Snippets (Terraform)

These snippets are normative examples for resource placement and naming. Final implementation can add fields, but file ownership must remain aligned.

`alb.tf`

```hcl
resource "aws_lb" "this" {
  name               = "${var.name}-alb"
  load_balancer_type = "application"
  internal           = false
  security_groups    = [aws_security_group.alb.id]
  subnets            = local.public_subnet_ids
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web-tg"
  port        = var.container_port
  protocol    = "HTTP"
  vpc_id      = local.vpc_id
  target_type = "ip"

  health_check {
    path = var.health_check_path
  }
}

resource "aws_lb_listener" "http" {
  count             = local.tls_enabled ? 0 : 1
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = local.tls_enabled ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  count             = local.tls_enabled ? 1 : 0
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.this[0].certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}
```

`rds.tf`

```hcl
resource "aws_db_subnet_group" "this" {
  count      = local.create_managed_rds ? 1 : 0
  name       = "${var.name}-db-subnets"
  subnet_ids = local.private_subnet_ids
}

resource "aws_db_instance" "this" {
  count                          = local.create_managed_rds ? 1 : 0
  identifier                     = "${var.name}-postgres"
  engine                         = "postgres"
  db_name                        = var.db_name
  username                       = var.db_username
  manage_master_user_password    = true
  allocated_storage              = var.db_allocated_storage
  instance_class                 = var.db_instance_class
  publicly_accessible            = false
  storage_encrypted              = true
  deletion_protection            = var.db_deletion_protection
  backup_retention_period        = var.db_backup_retention_days
  vpc_security_group_ids         = [aws_security_group.db.id]
  db_subnet_group_name           = aws_db_subnet_group.this[0].name
  skip_final_snapshot            = false
}
```

`elasticache.tf`

```hcl
resource "aws_elasticache_subnet_group" "this" {
  count      = local.create_managed_redis && var.redis_deployment_mode == "replication_group" ? 1 : 0
  name       = "${var.name}-redis-subnets"
  subnet_ids = local.private_subnet_ids
}

resource "aws_elasticache_replication_group" "this" {
  count                      = local.create_managed_redis && var.redis_deployment_mode == "replication_group" ? 1 : 0
  replication_group_id       = "${var.name}-redis"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  subnet_group_name          = aws_elasticache_subnet_group.this[0].name
  security_group_ids         = [aws_security_group.redis.id]
}

resource "aws_elasticache_serverless_cache" "this" {
  count      = local.create_managed_redis && var.redis_deployment_mode == "serverless" ? 1 : 0
  engine     = "redis"
  name       = "${var.name}-redis-serverless"
  subnet_ids = local.private_subnet_ids
  security_group_ids = [aws_security_group.redis.id]
}
```

`waf.tf`

```hcl
resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.waf_mode == "existing" ? 1 : 0
  resource_arn = aws_lb.this.arn
  web_acl_arn  = var.waf_web_acl_arn
}
```

`dns.tf`

```hcl
resource "aws_acm_certificate" "this" {
  count             = var.dns_mode == "route53" ? 1 : 0
  domain_name       = var.domain_name
  validation_method = "DNS"
}

resource "aws_route53_record" "validation" {
  for_each = var.dns_mode == "route53" ? {
    for dvo in aws_acm_certificate.this[0].domain_validation_options :
    dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  } : {}

  zone_id = var.hosted_zone_id
  name    = each.value.name
  type    = each.value.type
  ttl     = 60
  records = [each.value.record]
}
```

`ecs.tf`

```hcl
resource "aws_ecs_cluster" "this" {
  name = "${var.name}-cluster"
}

resource "aws_ecs_service" "web" {
  name            = "${var.name}-web"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_service.desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.private_subnet_ids
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "app"
    container_port   = var.container_port
  }
}
```

  

### Configuration Contract

Core mode selectors:

- `networking_mode = "managed" | "existing"`

- `database_mode = "managed" | "external"`

- `redis_mode = "managed" | "external"`

- `dns_mode = "none" | "route53"`

- `runtime_mode = "single_service" | "split_workers"`

  

Input validation must enforce:

- Required fields for each mode.

- Mutual exclusion between managed and external dependency fields.

- Minimum subnet count across 2 AZs where applicable.

- In existing-network mode, explicit runtime egress prerequisites: either NAT path or required VPC endpoints for ECR, CloudWatch Logs, and Secrets Manager/SSM.

- In split runtime mode:

- `worker_services` must be non-empty.

- Effective web runtime environment must force app-only process behavior (`AUTO_SPAWN_WORKERS=false`, `AUTO_SPAWN_SCHEDULER=false`).

- Effective queue strategy must be async (`QUEUE_STRATEGY=async`).



### Required Inputs

- `name` (string): deployment prefix.

- `aws_region` (string).

- `image` (string): full container image reference (including tag or digest).

- `container_port` (number, default `3000`).

- `env` (map(string)): environment variables for OpenMercato container.

- `runtime_mode` (string: `single_service|split_workers`, default `single_service`).

- `web_service` (object): CPU/memory/desired_count/command/env/secrets/autoscaling for ALB-backed web service.

- `worker_services` (map(object)): per-worker-service CPU/memory/desired_count/command/env/secrets/autoscaling.

- `scheduler_sync_task` (object): optional one-shot task command/env/secrets for async scheduler sync (`yarn mercato scheduler start`).

  

### Networking Inputs

- `networking_mode` (string: `managed|existing`).

- Managed mode:

- `vpc_cidr`, `public_subnet_cidrs`, `private_subnet_cidrs`.

- Existing mode:

- `vpc_id`, `public_subnet_ids`, `private_subnet_ids`.

  

### Database Inputs

- `database_mode` (string: `managed|external`).

- Managed mode:

- `db_name`, `db_username`, sizing and backup parameters.

- Managed RDS credentials must use provider-managed secret flow (`manage_master_user_password = true`) by default.

- External mode:

- `database_url_secret_arn` OR (`db_host`, `db_port`, `db_name`, `db_username`, `db_password_secret_arn`).

- `database_url` plaintext input is not allowed in production module usage.

- Note: critical secrets must not be committed as plain strings in repository files or Terraform variables files tracked by git; use AWS Secrets Manager secret ARNs or AWS SSM Parameter Store references.

  

### Redis Inputs

- `redis_mode` (string: `managed|external`).

- Managed mode:

- `redis_deployment_mode` (string: `replication_group|serverless`).

- Replication group path: `redis_node_type`, `redis_engine_version`, `redis_multi_az`.

- Serverless path: `redis_engine_version`, optional usage limits/snapshot settings supported by provider.

- External mode:

- `redis_url_secret_arn`.

- `redis_url` plaintext input is not allowed in production module usage.

- Note: if Redis URL contains credentials, it must be sourced from AWS Secrets Manager or SSM Parameter Store reference, not stored as plaintext in repository-managed files.

  

### DNS/TLS Inputs

- `dns_mode` (string: `none|route53`).

- Route53 mode:

- `domain_name`, `hosted_zone_id`, `create_www_record` (optional), `acm_validation_method = "DNS"`.

  

### WAF Inputs

- `waf_mode` (string: `none|existing`).

- Existing mode:

- `waf_web_acl_arn` to associate an existing custom WAFv2 Web ACL with the ALB.

  

### Outputs

- `alb_dns_name`

- `service_name`

- `web_service_name`

- `worker_service_names`

- `cluster_name`

- `database_endpoint` (managed mode)

- `redis_endpoint` (managed mode)

- `application_url` (custom domain if configured, otherwise ALB URL)

- `scheduler_sync_task_definition_arn` (when enabled)


## Configuration


### Container Environment Strategy

- `env` map is merged with module-derived connection values.

- Generated values:

- Non-secret values use environment variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, etc.).

- Secret values (`DATABASE_URL`, `REDIS_URL`, passwords/tokens) must be injected through ECS task definition `secrets` entries.

- User-provided env keys can override only if explicitly enabled via `allow_env_override_critical`.

- `allow_env_override_critical` must default to `false`.

- In `runtime_mode = split_workers`, module-enforced runtime env values must take precedence over user env for:

- `AUTO_SPAWN_WORKERS=false`

- `AUTO_SPAWN_SCHEDULER=false`

- `QUEUE_STRATEGY=async`

- Shared base env/secrets must be merged into each service; service-specific env/secrets then apply on top.

  

### Secrets Handling

- Sensitive fields must be sourced from Secrets Manager or SSM parameter references where possible.

- Sensitive Terraform variables marked `sensitive = true`.

- Module must avoid outputting plaintext credentials.

- Critical secret values must never be stored as plain strings in repository-managed files; they must be passed as AWS Secrets Manager or AWS SSM Parameter Store references and injected into ECS as secrets.

- Module must not read secret payloads into Terraform state (no secret-value resolution in locals/outputs).

  

### Terraform and Provider Compatibility

- Terraform version constraint: `>= 1.8`.

- AWS provider constraint must be explicitly pinned to the minimum version required for Redis serverless and WAFv2 association support.

- Module README must include an AWS region compatibility matrix, especially for `redis_deployment_mode = serverless`.

  

### ECS Runtime Settings

- Web and worker tasks must be independently configurable for CPU/memory/desired count.

- Worker services must support command overrides and per-service autoscaling controls.

- Health check path configurable (default `/health`).

- Deployment rolling update thresholds configurable for each ECS service.

- Optional autoscaling based on CPU and memory for web and worker services independently.

- Worker services must not be attached to the ALB target group.

  

### Managed Resource Security Baseline

- RDS: `publicly_accessible = false`, storage encryption enabled, deletion protection enabled by default, backup retention default >= 7 days.

- ElastiCache: transit encryption enabled (where supported), at-rest encryption enabled (where supported), subnet-restricted access only.

- Security groups: managed DB/Redis ingress allowed only from ECS task security group.

- ALB/TLS: when `dns_mode = route53`, HTTPS listener enabled and HTTP redirects to HTTPS.

  

### Existing Network Prerequisites

- Existing mode requires:

- Private subnets for ECS tasks.

- Public subnets for ALB.

- One of:

- NAT egress route for private subnets, or

- VPC endpoints sufficient for ECS startup/runtime dependencies (ECR API/DKR, CloudWatch Logs, Secrets Manager/SSM, and S3 where required by image pull path).

- Spec must treat these prerequisites as mandatory validation/documentation, not optional guidance.


## Implementation Plan

  

### Phase 0: Repository Creation and Bootstrap

1. Create a dedicated repository in the OpenMercato organization for the ECS Terraform module (for example `terraform-aws-openmercato-ecs`).

2. Bootstrap repository standards: `README.md`, license, `.gitignore`, ownership metadata, and CI workflow skeleton.

3. Configure repository CI to run Terraform quality gates on module and example stacks.

  

### Phase 1: Module Skeleton and Compute Baseline

1. Create split module structure (`versions.tf`, `variables.tf`, `locals.tf`, `ecs.tf`, `alb.tf`, `iam.tf`, `logging.tf`, `outputs.tf`) and variable contracts.

2. Implement ECS cluster, task definition, service, ALB, IAM, and CloudWatch logs in their dedicated files.

3. Implement required input validation and output surface.

  

### Phase 2: Runtime Split (Web + Workers)

1. Implement `runtime_mode` with `single_service` default and `split_workers` optional mode.

2. Implement dedicated ECS service resources for `web_service` and `worker_services` (worker services without ALB).

3. Implement command override support per service and service-specific env/secrets merge behavior.

4. Implement optional `scheduler_sync_task` task definition for one-shot async schedule sync.

5. Implement split-mode runtime guardrails: force `AUTO_SPAWN_WORKERS=false`, `AUTO_SPAWN_SCHEDULER=false`, and `QUEUE_STRATEGY=async`.

  

### Phase 3: Networking Modes

1. Implement managed networking resources per `.ai/specs/ecs-networking.md`.

2. Implement existing networking path (`vpc_id`, subnet IDs).

3. Add validation for AZ spread and subnet role expectations.

  

### Phase 4: Database and Redis Modes

1. Implement managed RDS provisioning and security boundaries.

2. Implement external DB path with strict validation.

3. Implement managed ElastiCache provisioning with `replication_group` and `serverless` sub-modes.

4. Implement external Redis secret-reference path.

5. Implement connection env assembly logic.

  

### Phase 5: DNS and Certificate Validation

1. Implement optional Route53 DNS record creation.

2. Implement ACM certificate request and DNS validation records.

3. Implement ALB HTTPS listener and HTTP->HTTPS redirect when TLS enabled.

  

### Phase 6: Optional WAF and Security Hardening

1. Implement optional WAFv2 custom Web ACL association with ALB using input ARN.

2. Validate that WAF configuration is mode-gated and does not affect non-WAF deployments.

  

### Phase 7: Examples and Validation

1. Add runnable examples for managed single-service, split-workers managed, external dependencies, existing network + DNS, and existing network + DNS + WAF.

2. Add required CI checks: `terraform fmt -check`, `terraform validate`, `tflint`, `tfsec`.

3. Add module README with decision matrix, compatibility matrix, and mode-specific examples.

  

  

### File Manifest

| File | Action | Purpose |
| --- | --- | --- |
| `<new-terraform-repo>/.github/workflows/terraform-ci.yml` | Create | Dedicated repository CI checks (`fmt`, `validate`, `tflint`, `tfsec`, example plans) |
| `<new-terraform-repo>/README.md` | Create | Repository-level usage, release, and contribution entrypoint |
| `infra/terraform/modules/openmercato-ecs/versions.tf` | Create | Terraform and provider version constraints |
| `infra/terraform/modules/openmercato-ecs/variables.tf` | Create | Typed input contracts and validation |
| `infra/terraform/modules/openmercato-ecs/locals.tf` | Create | Derived mode flags, env merge logic, and selectors |
| `infra/terraform/modules/openmercato-ecs/networking.tf` | Create | Managed VPC/subnets/routes/NAT and existing-network selectors |
| `infra/terraform/modules/openmercato-ecs/security_groups.tf` | Create | ALB, app, DB, and Redis security groups/rules |
| `infra/terraform/modules/openmercato-ecs/alb.tf` | Create | ALB, target group, listeners, listener rules |
| `infra/terraform/modules/openmercato-ecs/ecs.tf` | Create | ECS cluster, task definitions, web/worker services, scheduler sync task |
| `infra/terraform/modules/openmercato-ecs/autoscaling.tf` | Create | ECS service autoscaling policies and targets |
| `infra/terraform/modules/openmercato-ecs/iam.tf` | Create | Task execution role, task role, IAM policies |
| `infra/terraform/modules/openmercato-ecs/logging.tf` | Create | CloudWatch log groups and retention |
| `infra/terraform/modules/openmercato-ecs/rds.tf` | Create | Managed PostgreSQL resources and mode-gated wiring |
| `infra/terraform/modules/openmercato-ecs/elasticache.tf` | Create | Managed Redis resources (`replication_group` and `serverless`) |
| `infra/terraform/modules/openmercato-ecs/dns.tf` | Create | Route53 records, ACM certificate and validation |
| `infra/terraform/modules/openmercato-ecs/waf.tf` | Create | Optional WAFv2 Web ACL association |
| `infra/terraform/modules/openmercato-ecs/outputs.tf` | Create | Stable output interface |
| `infra/terraform/modules/openmercato-ecs/README.md` | Create | Usage, examples, mode matrix |
| `infra/terraform/examples/minimal-managed/*` | Create | Quick-start fully managed deployment |
| `infra/terraform/examples/split-workers-managed/*` | Create | Web + worker ECS services with managed DB/Redis |
| `infra/terraform/examples/external-dependencies/*` | Create | External DB/Redis deployment pattern |
| `infra/terraform/examples/existing-network-with-dns/*` | Create | Existing VPC/subnets + Route53/ACM pattern |
| `infra/terraform/examples/existing-network-with-dns-waf/*` | Create | Existing VPC + DNS/TLS + optional WAF association pattern |

  

### Testing Strategy

- Required CI checks: `terraform fmt -check`, `terraform validate` for module and all examples, `tflint`, `tfsec`.

- Required plan smoke in CI for each example stack.

- Required integration smoke: apply in sandbox AWS account for each supported mode family before release.

  

Integration coverage declaration (required):

- Affected OpenMercato API paths: none.

- Affected OpenMercato UI paths: none.

- Infrastructure validation paths:

- Managed mode: ECS + RDS + ElastiCache (`replication_group` and `serverless`) + ALB reachable.

- Split runtime mode: web ECS service healthy via ALB while worker ECS services consume queues independently.

- External dependency mode: ECS service healthy with external connection inputs.

- Existing network mode: ECS service healthy in user VPC/subnets.

- DNS mode: certificate status `ISSUED`, HTTPS endpoint reachable.

- WAF mode: custom Web ACL associated with ALB and traffic still routes to healthy ECS targets.

  

### Validation Matrix (Required)

| Area | Valid Configuration | Invalid Configuration | Expected Validation Behavior |
| --- | --- | --- | --- |
| Database mode | `database_mode=managed` with managed-only DB inputs | Managed mode + external DB inputs mixed | Fail `terraform validate` with explicit mutual-exclusion error |
| Database external URL | `database_mode=external` + `database_url_secret_arn` | External mode + plaintext `database_url` in production | Fail validation with secret-reference requirement |
| Redis mode | `redis_mode=external` + `redis_url_secret_arn` | External mode + plaintext `redis_url` in production | Fail validation with secret-reference requirement |
| DNS mode | `dns_mode=route53` + `domain_name` + `hosted_zone_id` | Route53 mode without hosted zone ID | Fail validation with required input error |
| WAF mode | `waf_mode=existing` + `waf_web_acl_arn` | `waf_mode=existing` without ARN | Fail validation with required ARN error |
| Runtime mode | `runtime_mode=split_workers` + at least one `worker_services` entry | `runtime_mode=split_workers` with empty `worker_services` | Fail validation with required worker service definition error |
| Split runtime queue strategy | Split mode effective env includes `QUEUE_STRATEGY=async` | Split mode with `QUEUE_STRATEGY=local` | Fail validation with async queue requirement error |
| Split runtime web process mode | Split mode web env forces `AUTO_SPAWN_WORKERS=false` and `AUTO_SPAWN_SCHEDULER=false` | Split mode with auto-spawn enabled | Fail validation with app-only web service requirement error |
| Existing network | Existing mode + private/public subnet IDs + egress prerequisites | Existing mode with missing private subnets or no egress path | Fail validation with subnet/egress prerequisite error |
