# Open Mercato on AWS — Terraform Deployment Playbook

> **Status:** Plan / playbook (illustrative HCL, not the final Terraform).
> **Scope:** One reusable Terraform child module that renders either a **dev / economy** topology or a **prod / HA** topology, selected entirely by `*.tfvars` values. ECS Fargate app, Aurora PostgreSQL Serverless v2 (pgvector), ElastiCache Redis (cache + queue), Meilisearch on Fargate + EFS, S3 attachments via the `storage-s3` module (ambient / task-role auth).
> **Date:** 2026-06-04

## 0. Decision Ledger (locked)

| # | Area | Decision |
|---|------|----------|
| 1 | Redis | ElastiCache first-class tier — dev single `cache.t4g.micro`; prod Multi-AZ replication group |
| 2 | Search | Meilisearch single Fargate task + EFS; recovery = Postgres reindex (+ optional prod dump-to-S3); **not HA** (OSS Meili can't cluster) |
| 3 | Files | `storage-s3` module, **ambient / ECS task-role** auth; one-time post-deploy marketplace step sets `authMode: ambient` |
| 4 | Migrations | Dedicated one-off ECS task (`yarn mercato init` / `yarn db:migrate` + extension bootstrap); app tasks run `yarn start` only |
| 5 | Trigger | Terraform-triggered (`null_resource` + `aws ecs run-task` + waiter, keyed on `app_image_tag`), gates app rollout |
| 6 | DB | Aurora Serverless v2 both envs; `vector` + `pgcrypto` pre-created by the bootstrap task |
| 7 | Ingress | ALB + ACM, platform domain only; custom-domain (Traefik/NLB) kept as a variable-gated future seam |
| 8 | TLS/DNS | Module takes an existing validated `acm_certificate_arn`; **zero DNS / Route 53 resources**; outputs ALB DNS name |
| 9 | Region | Module input variable (no default); single region per env |
| 10 | Secrets | Secrets Manager + customer-managed KMS; TF-generated via `random_password`; third-party keys = empty manual placeholders |
| 11 | Structure | One child module, **no workspaces**, `live/dev` + `live/prod`, S3 backend (native lock), single region |
| 12 | Compute | Fargate everywhere; module-created ECR; `app_image_tag` input |
| 13 | Network | `create_vpc` toggle (own or existing); single NAT dev / per-AZ NAT prod |
| 14 | Observability | CloudWatch Logs + Container Insights + baseline alarms; New Relic off by default; email stays Resend |

> **Review note:** This document was drafted by parallel section authors and then passed through a consistency critic. The fixes that critic raised are applied inline; **§8 Hardening Checklist** captures every correction for traceability.

---

## 1. Architecture Overview & Economy-vs-HA Topology

### Goal

One reusable Terraform child module (`modules/open-mercato/`) renders both the **dev/economy** and **prod/HA** topology for the Open Mercato platform. The economy-vs-HA difference is driven entirely by **variable values**, never by `count`-hacking or workspaces. A thin live layer (`live/dev`, `live/prod`) calls the module with `environments/<env>.tfvars` and a separate state key per env.

The app is a stateless Next.js container (port `3000`, started with `yarn start`). All stateful concerns are externalized to managed/dedicated tiers — Aurora PostgreSQL Serverless v2, ElastiCache Redis, a single Meilisearch Fargate task on EFS, and S3 for attachments. Migrations never run on app tasks; a dedicated one-off Fargate task owns schema + extension bootstrap. There is **no bastion** — operators reach the system through the ALB, ECS Exec, and `aws ecs run-task`, not SSH.

### Architecture Diagram

```
                              Internet
                                 │  :443 (ACM cert, acm_certificate_arn)
                                 ▼
                    ┌─────────────────────────┐   public subnets
                    │   ALB  (80 → 443 redir) │   (1 AZ dev / N AZ prod)
                    └─────────────────────────┘
                                 │  target group :3000
                                 ▼
        ┌──────────────────────────────────────────────────┐
        │     ECS Fargate — App Service  (yarn start)       │  private subnets
        │  desired_count: 1 (dev) / >=2 across AZs (prod)   │  command overridden,
        │  stateless · no migration marker · ECS Exec on    │  fully stateless
        └──────────────────────────────────────────────────┘
            │ DATABASE_URL     │ CACHE_REDIS_URL   │ MEILISEARCH_HOST   │ task role (ambient)
            ▼                  ▼                   ▼                    ▼
   ┌─────────────────┐ ┌───────────────┐ ┌──────────────────┐ ┌──────────────────┐
   │ Aurora Sv2 PG   │ │ ElastiCache   │ │ Meilisearch      │ │ S3 bucket        │
   │ (vector,        │ │ Redis/Valkey  │ │ Fargate task     │ │ (1 per env,      │
   │  pgcrypto)      │ │ cache + queue │ │ + EFS /meili_data│ │  least-priv IAM) │
   │ writer (+reader)│ │ (+replicas    │ │ NOT HA · reindex │ │ Get/Put/Del/List │
   │ Multi-AZ prod   │ │  Multi-AZ prod)│ │ from PG on loss  │ │                  │
   └─────────────────┘ └───────────────┘ └──────────────────┘ └──────────────────┘
            ▲
            │ runs once, gates app update (TF null_resource + run-task waiter)
   ┌──────────────────────────────────────────────────────────┐
   │  ECS Fargate — Migration ONE-OFF task                     │
   │  yarn mercato init (bootstrap) / yarn db:migrate (deploy) │
   │  CREATE EXTENSION vector, pgcrypto  (Aurora master role)  │
   │  triggered on app_image_tag change                        │
   └──────────────────────────────────────────────────────────┘

  Egress: NAT GW — single (dev) / one-per-AZ (prod).  Secrets: Secrets Manager + CMK
  → injected via task-def `secrets` valueFrom.   Logs/alarms → CloudWatch + Container Insights.
```

**Bastion-less flow.** No SSH host exists. Schema changes flow through the Terraform-triggered migration task (`aws ecs run-task` + waiter, keyed on `app_image_tag`); a non-zero exit fails the apply and the app service update is gated behind it. Interactive debugging uses **ECS Exec** into the app task. Data tiers (Aurora, Redis, EFS) accept inbound **only from the app SG**, so there is no public data-plane surface to bastion into.

### Dev (economy) vs Prod (HA) — Tier-by-Tier

| Tier | Variable(s) | dev / economy | prod / HA |
|------|-------------|---------------|-----------|
| **VPC** | `create_vpc`, `existing_vpc_id`, subnet IDs | `create_vpc=true`, subnets across 2 AZs (or BYO VPC) | `create_vpc=true`, subnets across 3 AZs (or BYO VPC) |
| **NAT** | `single_nat_gateway` | `true` — single NAT GW | `false` — one NAT GW per AZ |
| **ALB** | `acm_certificate_arn` | 1, public subnets, 80→443 redirect, ACM cert | 1, public subnets across AZs, 80→443 redirect, ACM cert |
| **App service** | `app_desired_count`, `app_autoscaling_max`, task CPU/mem | `desired_count=1`, minimal task size, no autoscaling | `desired_count>=2` across AZs, target-tracking autoscale on CPU + ALB request count up to `app_autoscaling_max` |
| **Aurora** | `aurora_min_acu`, `aurora_max_acu`, `aurora_reader_count` | Serverless v2, single instance, **0.5–2 ACU**, single-AZ | Serverless v2, writer + `aurora_reader_count>=1` reader in another AZ, **2–16 ACU**, Multi-AZ failover |
| **Redis** | `redis_multi_az` | single node `cache.t4g.micro`, no replica, no Multi-AZ | replication group `m7g.large`, 1–2 replicas, `redis_multi_az=true` + auto-failover, encryption in transit + at rest |
| **Meilisearch** | `meili_instance` | 1 Fargate task + EFS, minimal size, auto-restart | 1 Fargate task + EFS, larger size, auto-restart; optional scheduled dump-to-S3 (NOT HA either way) |
| **S3 / attachments** | task role, bucket per env | 1 bucket, least-priv `Get/Put/Delete/List`, ambient auth | 1 bucket, least-priv `Get/Put/Delete/List`, ambient auth |
| **Backups / PITR** | backup retention | automated backups, short retention | PITR + automated backups **7–30d**, KMS-encrypted |
| **Deletion protection** | `deletion_protection` | OFF | **ON** (Aurora) |
| **Secrets** | KMS CMK | Secrets Manager + CMK; TF-generated + empty 3rd-party placeholders | same; placeholders filled out-of-band, never in state |
| **Log retention** | `log_retention_days` | **7d** | **30–90d** |
| **Alarms** | baseline alarms | ALB 5xx, target health, Aurora CPU/connections, Redis evictions | same baseline (tighter thresholds) |
| **Container Insights** | cluster setting | on | on |
| **New Relic** | `newrelic_enabled` | OFF (empty `NEW_RELIC_*`) | OFF by default; opt-in via var + Secrets entry |

### Illustrative wiring

A single module call, parameterized per env (`live/prod/main.tf`):

```hcl
module "open_mercato" {
  source = "../../modules/open-mercato"

  region              = var.region            # no default; customer decides
  create_vpc          = true
  single_nat_gateway  = false                 # one NAT per AZ in prod
  acm_certificate_arn = var.acm_certificate_arn

  aurora_min_acu      = 2
  aurora_max_acu      = 16
  aurora_reader_count = 1
  deletion_protection = true

  redis_multi_az      = true
  redis_node_type     = "cache.m7g.large"

  app_desired_count   = 2
  app_autoscaling_max = 10
  meili_instance      = "prod"

  app_image_tag       = var.app_image_tag     # also keys the migration trigger
}
```

App tasks run `yarn start` only — the container command is overridden so the image's init/migrate entrypoint (`docker/scripts/init-or-migrate.sh`, marker-file based) can never race across N tasks:

```hcl
container_definitions = [{
  name    = "app"
  command = ["yarn", "start"]   # migrations live in the one-off task, not here
  portMappings = [{ containerPort = 3000 }]
  # env + secrets (valueFrom) omitted — see Task Definition section
}]
```

### Monthly Cost Ballpark (order-of-magnitude estimate)

> Estimate only — excludes data transfer, S3/attachment volume, AI/Resend usage, and NAT data-processing spikes. Region-dependent; figures are us-east-1-ish.

| Component | dev / economy | prod / HA |
|-----------|---------------|-----------|
| Aurora Sv2 (ACU-hours) | ~$45–90 | ~$300–700 |
| ElastiCache Redis | ~$12 (t4g.micro) | ~$250–400 (m7g.large + replicas, Multi-AZ) |
| Fargate (app + Meili) | ~$30–50 | ~$200–400 |
| ALB | ~$18 | ~$25–40 |
| NAT GW | ~$33 (single) | ~$100–130 (per-AZ) |
| EFS + S3 + Secrets + CloudWatch | ~$15–30 | ~$60–120 |
| **Rough total / month** | **~$150–250 (estimate)** | **~$1,000–1,800 (estimate)** |

The biggest economy levers are `single_nat_gateway`, Redis node type + `redis_multi_az`, and Aurora `*_acu` bounds — all variable-driven, so an env can be dialed between these two profiles without structural changes.

---

## 2. Terraform Repository Structure, Module & Variable Design

### 2.1 Repository layout

One reusable child module, a thin per-env live layer that only supplies values, and a standalone bootstrap stack for the state backend. No count-hacking between economy and HA — the difference is entirely in `*.tfvars`.

```
deploy/terraform/
├── bootstrap/                     # one-time, SEPARATE state (local or hand-migrated)
│   ├── main.tf                    # state S3 bucket + KMS CMK + bucket policy
│   ├── variables.tf
│   ├── outputs.tf                 # state_bucket_name, state_kms_key_arn
│   └── README.md                  # "run this first, once per account/region"
│
├── modules/
│   └── open-mercato/              # THE module — everything is parameterized here
│       ├── main.tf                # composition / locals
│       ├── variables.tf           # rich tiering var set (2.4)
│       ├── outputs.tf             # alb_dns_name, dns_instructions, ecr_repo_url, ...
│       ├── vpc.tf                 # create_vpc toggle, subnets, NAT lever
│       ├── ecs.tf                 # cluster, app service, autoscaling
│       ├── ecs_app_taskdef.tf     # app task (command = yarn start), secrets block
│       ├── ecs_migrate.tf         # one-off migration task def + run-task trigger
│       ├── ecs_meili.tf           # Meili Fargate task + EFS
│       ├── alb.tf                 # ALB, 80→443 redirect, ACM listener (arn input)
│       ├── aurora.tf              # Serverless v2 writer/reader, ACU autoscaling
│       ├── redis.tf               # ElastiCache single-node vs replication group
│       ├── s3_attachments.tf      # attachments bucket + task-role policy
│       ├── ecr.tf                 # private repo + lifecycle policy
│       ├── secrets.tf             # random_password → SM; empty API-key placeholders
│       ├── security_groups.tf     # app-only ingress to Aurora/Redis/EFS
│       ├── cloudwatch.tf          # log groups, Container Insights, baseline alarms
│       └── iam.tf                 # task exec role, task role (ambient S3), migrate role
│
└── live/
    ├── dev/
    │   ├── backend.tf             # S3 backend, key = dev/terraform.tfstate
    │   ├── main.tf                # module "open_mercato" { ... }
    │   ├── providers.tf           # provider "aws" { region = var.region }
    │   └── environments/dev.tfvars
    └── prod/
        ├── backend.tf             # key = prod/terraform.tfstate
        ├── main.tf
        ├── providers.tf
        └── environments/prod.tfvars
```

State is keyed per env (`dev/terraform.tfstate`, `prod/terraform.tfstate`) so a `dev` apply can never touch `prod` state. `dev` and `prod` are physically separate root configs — blast radius is structural, not convention-based.

### 2.2 State backend — S3 native lockfile (no DynamoDB)

The state bucket and KMS CMK **pre-exist** (created by `bootstrap/`, see 2.6). A module can't cleanly create the backend it is stored in, so this is a deliberate one-time prerequisite. Locking uses S3's native lockfile (`use_lockfile = true`, Terraform ≥ 1.10) — no DynamoDB table.

`live/dev/backend.tf`:

```hcl
terraform {
  required_version = ">= 1.10"
  backend "s3" {
    bucket       = "om-tfstate-<account-id>"   # pre-existing, versioned + SSE-KMS
    key          = "dev/terraform.tfstate"     # one key per env
    region       = "<state-region>"
    kms_key_id   = "<state-kms-key-arn>"        # CMK from bootstrap
    encrypt      = true
    use_lockfile = true                         # native S3 lock, replaces DynamoDB
  }
}
```

`prod/backend.tf` is identical except `key = "prod/terraform.tfstate"`. Because TF-generated secrets (`JWT_SECRET`, `TENANT_DATA_ENCRYPTION_KEY` + fallback, Meili master key, Aurora password) land in state via `random_password`, **state encryption is mandatory, not optional** — the SSE-KMS bucket is what keeps those values at rest-encrypted.

### 2.3 Live layer calling the module

`live/dev/main.tf` — the live layer is glue only: it wires pre-existing ARNs and the tfvars-driven tiering into one module call.

```hcl
module "open_mercato" {
  source = "../../modules/open-mercato"

  environment         = "dev"
  region              = var.region
  acm_certificate_arn = var.acm_certificate_arn   # already validated, customer-owned
  platform_domains    = var.platform_domains
  app_image_tag       = var.app_image_tag         # also keys the migration trigger

  # everything below comes from environments/dev.tfvars
  create_vpc          = var.create_vpc
  single_nat_gateway  = var.single_nat_gateway
  aurora_min_acu      = var.aurora_min_acu
  aurora_max_acu      = var.aurora_max_acu
  aurora_reader_count = var.aurora_reader_count
  redis_multi_az      = var.redis_multi_az
  redis_node_type     = var.redis_node_type
  app_desired_count   = var.app_desired_count
  app_autoscaling_max = var.app_autoscaling_max
  meili_instance      = var.meili_instance
}

output "alb_dns_name"      { value = module.open_mercato.alb_dns_name }
output "dns_instructions"  { value = module.open_mercato.dns_instructions }
```

The module makes **zero DNS changes** — it consumes `acm_certificate_arn` and outputs `alb_dns_name` plus the record the customer should already be pointing at it (`dns_instructions`). `app_image_tag` is passed straight through because it both selects the ECR image and keys the migration `null_resource` trigger.

### 2.4 Curated `variables.tf` excerpt (the tiering knobs)

Economy vs HA is expressed purely as values. Same module, two value sets:

```hcl
variable "environment"         { type = string }   # "dev" | "prod"
variable "region"              { type = string }   # NO default — customer decides
variable "acm_certificate_arn" { type = string }
variable "platform_domains"    { type = string }
variable "app_image_tag"       { type = string }

# --- VPC / cost levers (NAT lever only meaningful when create_vpc = true) ---
variable "create_vpc"          { type = bool }
variable "single_nat_gateway"  { type = bool }

# --- Aurora Serverless v2 tiering ---
variable "aurora_min_acu"      { type = number }   # capacity floor
variable "aurora_max_acu"      { type = number }   # autoscaling ceiling
variable "aurora_reader_count" { type = number }   # 0 in dev, >=1 (other AZ) in prod

# --- Redis tiering (single node vs replication group) ---
variable "redis_node_type"     { type = string }
variable "redis_multi_az"      { type = bool }     # drives replication + auto-failover

# --- App service / autoscaling ---
variable "app_desired_count"   { type = number }
variable "app_autoscaling_max" { type = number }

# --- Meili Fargate sizing ---
variable "meili_instance"      { type = string }   # cpu/mem profile key
```

Side-by-side values:

| Variable | `dev.tfvars` | `prod.tfvars` | Effect |
|---|---|---|---|
| `create_vpc` | `true` | `true` | module builds VPC (set `false` + pass IDs to reuse one) |
| `single_nat_gateway` | `true` | `false` | dev: 1 NAT GW; prod: one NAT GW per AZ |
| `aurora_min_acu` / `aurora_max_acu` | `0.5` / `2` | `2` / `16` | floor + autoscaling ceiling |
| `aurora_reader_count` | `0` | `1` (≥1, other AZ) | single-AZ vs Multi-AZ failover reader |
| `redis_node_type` | `cache.t4g.micro` | `cache.m7g.large` | node size |
| `redis_multi_az` | `false` | `true` | single node vs replication group + auto-failover + encryption in transit/at rest |
| `app_desired_count` | `1` | `2` | min running tasks (prod ≥2 across AZs) |
| `app_autoscaling_max` | `1` | e.g. `8` | target-tracking ceiling (CPU + ALB req count) |
| `meili_instance` | small | larger | single non-HA Meili task either way; recovery = reindex from Postgres |

Booleans like `redis_multi_az` and `aurora_reader_count` fan out internally (e.g. a replication group vs a single `cache_cluster`, conditional reader instances) — the live layer never sees that branching. Within the module, validate cross-var invariants (e.g. `aurora_reader_count >= 1` and `single_nat_gateway = false` when `environment == "prod"`) so a misconfigured prod tfvars fails at plan time.

Other module inputs not shown above but referenced by the ledger: `redis` URL/secret wiring, `new_relic_enabled` (false by default, behind its own var + optional SM entry), and the empty-placeholder API-key secrets (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `RESEND_API_KEY`) created by the module but filled out-of-band so they never enter state.

### 2.5 Why no workspaces

Terraform workspaces are rejected on purpose:

- **One backend, many workspaces is a footgun.** Workspaces share a single state bucket/key prefix and one provider config; a `terraform workspace select` mistake lets a `dev` apply hit `prod`. Separate `live/dev` + `live/prod` roots with distinct state keys make that physically impossible.
- **Tiering is data, not a runtime selector.** Economy vs HA is driven by `environments/<env>.tfvars` values feeding the same module — `var.environment` plus the tfvars *is* the environment switch. Workspaces would add a second, parallel notion of "which env" (`terraform.workspace`) that has to be kept in sync with the tfvars, inviting drift.
- **Per-env provider/region/credentials.** Each root has its own `providers.tf` and `backend.tf`, so region (a no-default input) and account boundaries are explicit per env. Workspaces force one provider block across all envs.
- **Reviewable blast radius.** `cd live/prod && terraform plan` is unambiguously a prod plan. No hidden global state selecting what you're about to change.

### 2.6 Bootstrap stack (state bucket + KMS)

`bootstrap/` is a small, run-once stack with its **own** state (local, or migrated into the bucket it creates after first apply). It exists because the backend can't bootstrap itself — the S3 bucket and CMK must exist before any `live/*` root can `terraform init`.

It provisions:

- **State S3 bucket** — versioning enabled (state history + recovery), SSE-KMS default encryption with the CMK below, public access fully blocked, and a bucket policy denying non-TLS and non-KMS writes.
- **KMS customer-managed key** — encrypts both the state bucket and (reused or paired with) the Secrets Manager entries, with rotation enabled and a key policy granting the deploy role `Encrypt/Decrypt/GenerateDataKey`.

```hcl
# bootstrap/main.tf (illustrative)
resource "aws_kms_key" "state" {
  description         = "OM terraform state + secrets CMK"
  enable_key_rotation = true
}

resource "aws_s3_bucket" "state" { bucket = "om-tfstate-${var.account_id}" }

resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.state.arn
    }
  }
}

output "state_bucket_name" { value = aws_s3_bucket.state.bucket }
output "state_kms_key_arn" { value = aws_kms_key.state.arn }
```

Its two outputs (`state_bucket_name`, `state_kms_key_arn`) are copied by hand into every `live/<env>/backend.tf`. Document this as the **first** step of any new-account install: run `bootstrap/` once, record the outputs, then `terraform init` each live root against them. No CI automation reaches across this boundary — it's an intentional one-time human gate before the recurring per-env applies take over.

---

## 3. Networking — VPC, Subnets, NAT lever, Security Groups, ALB

This section wires the network substrate: a togglable VPC, a cost-controlled NAT lever, a least-privilege security-group matrix, and an ALB fronting the private app tasks via an existing ACM cert. The module makes **zero DNS changes** — it only outputs the ALB DNS name for the customer to point their record at.

### 3.1 VPC: `create_vpc` toggle

The module either builds its own VPC or attaches to an existing one. Both paths feed the *same* downstream SGs/ALB/ECS wiring — nothing else in the module branches on this.

- `create_vpc = true` → module builds the VPC: public + private subnets across **≥2 AZs**, an internet gateway, and route tables. Public subnets host the ALB and NAT gateway(s); private subnets host all Fargate tasks (app service, Meilisearch, migration one-off).
- `create_vpc = false` → module consumes `existing_vpc_id`, `existing_public_subnet_ids`, and `existing_private_subnet_ids` from tfvars. No IGW/subnet/route resources are created.

```hcl
variable "create_vpc"                 { type = bool }
variable "existing_vpc_id"            { type = string  default = null }
variable "existing_public_subnet_ids" { type = list(string) default = [] }
variable "existing_private_subnet_ids"{ type = list(string) default = [] }

locals {
  vpc_id             = var.create_vpc ? module.vpc[0].vpc_id          : var.existing_vpc_id
  public_subnet_ids  = var.create_vpc ? module.vpc[0].public_subnets  : var.existing_public_subnet_ids
  private_subnet_ids = var.create_vpc ? module.vpc[0].private_subnets : var.existing_private_subnet_ids
}
```

All ALB/ECS/SG resources reference `local.vpc_id` and the `local.*_subnet_ids` lists, so the existing-VPC path is a drop-in.

### 3.2 NAT cost lever: `single_nat_gateway`

Private subnets reach the internet (image pulls when not using endpoints, Resend, AI providers, AWS APIs) through NAT. This lever **only applies when `create_vpc = true`**; with an existing VPC the customer owns NAT.

- **dev:** `single_nat_gateway = true` → one NAT GW shared by all AZs (cheapest; AZ NAT outage is acceptable in dev).
- **prod:** `single_nat_gateway = false` → one NAT GW **per AZ** (no cross-AZ NAT dependency, no single point of failure for egress).

```hcl
# tfvars
# dev:  single_nat_gateway = true
# prod: single_nat_gateway = false
```

### 3.3 Security group matrix

One SG per tier. Backing-store SGs (`aurora`, `redis`, `efs`) accept inbound **only** from the app SG, each on its own port. The ALB is the only internet-facing SG.

| SG | Inbound | Source | Outbound |
|----|---------|--------|----------|
| `alb` | 443 | `0.0.0.0/0` | app SG :3000 |
| `alb` | 80 (redirect→443 only) | `0.0.0.0/0` | — |
| `app` | 3000 | `alb` SG | all (egress to NAT/endpoints, stores) |
| `aurora` | 5432 | `app` SG | — |
| `redis` | 6379 | `app` SG | — |
| `efs` | 2049 (NFS) | `app` SG | — |

The migration one-off task and Meilisearch task share the `app` SG (so they reach Aurora 5432 and EFS 2049 respectively); Meilisearch is reached by the app over 7700 within the `app` SG, no extra ingress from outside.

```hcl
resource "aws_security_group_rule" "aurora_from_app" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.aurora.id
  source_security_group_id = aws_security_group.app.id
}
# redis (6379) and efs (2049) follow the identical pattern.
```

### 3.4 ALB + ACM (existing cert ARN)

The ALB lives in the **public** subnets; app tasks live in the **private** subnets and are only reachable via the target group.

- HTTPS listener on **443** uses the customer-supplied, already-validated `acm_certificate_arn` (input variable — the module creates **no** ACM resources).
- HTTP listener on **80** is a fixed **301 redirect to 443** (no forward action).
- Target group: `target_type = "ip"` (Fargate awsvpc), port **3000**, protocol HTTP.
- Health check path `/api/health` (HTTP 200), interval 30s, healthy/unhealthy thresholds tuned so a rolling deploy drains cleanly. App is stateless, so any healthy task can serve.

```hcl
variable "acm_certificate_arn" { type = string }   # pre-validated, customer-owned

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action { type = "forward"  target_group_arn = aws_lb_target_group.app.arn }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.this.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect { port = "443" protocol = "HTTPS" status_code = "HTTP_301" }
  }
}

resource "aws_lb_target_group" "app" {
  name        = "om-${var.env}-app"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.vpc_id
  health_check { path = "/api/health" matcher = "200" interval = 30 }
}
```

`PLATFORM_DOMAINS` / `APP_URL` must resolve to this ALB for the app to render absolute URLs correctly — but DNS itself is out of scope (see below).

### 3.5 DNS: explicitly out of scope

The module creates **no Route 53 records, zones, or ACM validation resources.** It only **outputs** the ALB DNS name and tells the operator what to point at it. The customer (or a separate DNS module) creates the alias/CNAME and owns cert validation for `acm_certificate_arn`.

```hcl
output "alb_dns_name" { value = aws_lb.this.dns_name }
output "alb_zone_id"  { value = aws_lb.this.zone_id }   # for an external Route53 alias
output "dns_record_to_create" {
  value = "Point your PLATFORM_DOMAINS record (ALIAS/CNAME) at ${aws_lb.this.dns_name}"
}
```

> Custom-domain ingress (per-tenant Traefik/NLB with on-demand ACME) is **OFF** and remains a documented, variable-gated future seam — not part of this networking layer.

### 3.6 VPC endpoints (optional NAT/egress cost cut)

When `create_vpc = true`, optionally provision endpoints behind a `enable_vpc_endpoints` flag so AWS-bound traffic skips NAT entirely (lower data-processing + per-GB NAT cost, and works even if NAT is degraded):

- **S3** — *Gateway* endpoint (free): attachments bucket + ECR layer storage. High-value, always worth enabling.
- **ECR (api + dkr)** — *Interface* endpoints: pull the app image without NAT.
- **Secrets Manager** — *Interface*: task-definition `secrets` `valueFrom` lookups at task start.
- **CloudWatch Logs** — *Interface*: container log shipping.

Interface endpoints attach an SG allowing **443 from the `app` SG** (and the migration/Meili tasks via the shared app SG). They are cost-neutral-to-positive at prod task counts and reduce reliance on the NAT lever; in dev they are usually left off (`enable_vpc_endpoints = false`) since the single NAT GW is cheap enough.

```hcl
# illustrative
resource "aws_vpc_endpoint" "s3" {
  count             = var.create_vpc && var.enable_vpc_endpoints ? 1 : 0
  vpc_id            = local.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = module.vpc[0].private_route_table_ids
}
```

---

## 4. Data & Cache Tier — Aurora Serverless v2 + ElastiCache Redis

This tier provisions the two stateful backends the app depends on: Aurora PostgreSQL (Serverless v2, pgvector-capable) and ElastiCache Redis (cache **and** queue). Both live in private subnets, accept inbound only from the app security group, and feed connection strings into the ECS task definition via Secrets Manager.

### 4.1 Aurora Serverless v2 (PostgreSQL + pgvector)

Engine pinned to a pgvector-capable PG major (15.x/16.x). Serverless v2 in **both** envs; the economy/HA split is driven entirely by variable values, not by `count` hacks.

| Setting | dev | prod | Driven by |
|---|---|---|---|
| Capacity (ACU) | 0.5–2 | 2–16 | `aurora_min_acu` / `aurora_max_acu` |
| Instances | writer only, single-AZ | writer + ≥1 reader in another AZ | `aurora_reader_count` |
| Multi-AZ failover | off | on | `aurora_reader_count >= 1` |
| Deletion protection | off | **on** | `aurora_deletion_protection` |
| Backup retention (PITR) | 7d | 7–30d | `aurora_backup_retention_days` |
| Storage encryption | KMS (CMK) | KMS (CMK) | `kms_key_arn` |

```hcl
resource "aws_rds_cluster" "this" {
  engine                  = "aurora-postgresql"
  engine_version          = var.aurora_engine_version   # e.g. "16.4"
  engine_mode             = "provisioned"                # required for Serverless v2
  database_name           = "open_mercato"
  master_username         = "om_master"
  master_password         = random_password.aurora.result
  storage_encrypted       = true
  kms_key_id              = var.kms_key_arn
  deletion_protection     = var.aurora_deletion_protection
  backup_retention_period = var.aurora_backup_retention_days
  db_subnet_group_name    = aws_db_subnet_group.aurora.name
  vpc_security_group_ids  = [aws_security_group.aurora.id]
  db_cluster_parameter_group_name = aws_rds_cluster_parameter_group.this.name

  serverlessv2_scaling_configuration {
    min_capacity = var.aurora_min_acu
    max_capacity = var.aurora_max_acu
  }
}

# Writer + reader(s). reader count == 0 in dev, >=1 in prod.
resource "aws_rds_cluster_instance" "this" {
  count               = 1 + var.aurora_reader_count
  cluster_identifier  = aws_rds_cluster.this.id
  instance_class      = "db.serverless"
  engine              = aws_rds_cluster.this.engine
  engine_version      = aws_rds_cluster.this.engine_version
  promotion_tier      = count.index            # 0 = writer-preferred
}
```

The reader instance(s) land in a different AZ via the multi-AZ subnet group, giving Multi-AZ automatic failover in prod. The app connects to the **cluster writer endpoint** (`aws_rds_cluster.this.endpoint`); readers are available on the reader endpoint for future read-splitting but are not wired into `DATABASE_URL` here.

**Parameter group.** A `db_cluster_parameter_group` (family `aurora-postgresql16`) is created mainly to pin engine-level settings and leave room for tuning (`shared_preload_libraries` is not required for pgvector). Keep it explicit so future params don't force a default-group swap.

#### Required extensions: `vector` + `pgcrypto`

Extensions are created **once, by the migration/bootstrap task** (Section "Migrations"), using the Aurora **master role** — the only role with `CREATE EXTENSION` privilege. This runs before the app service is updated:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

The app's runtime `CREATE EXTENSION` calls (search/pgvector driver) become **no-ops** because the extensions already exist — and the app DB role does not need superuser/extension privileges. `gen_random_uuid()` is core in PG13+, so no extra work there.

#### `DATABASE_URL` assembly

The master password is TF-generated and never hand-entered:

```hcl
resource "random_password" "aurora" {
  length  = 32
  special = false   # avoid URL-encoding hazards in the DSN
}

resource "aws_secretsmanager_secret" "database_url" {
  name       = "${var.name_prefix}/database-url"
  kms_key_id = var.kms_key_arn
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgres://%s:%s@%s:5432/%s",
    aws_rds_cluster.this.master_username,
    random_password.aurora.result,
    aws_rds_cluster.this.endpoint,
    aws_rds_cluster.this.database_name,
  )
}
```

Because `random_password` and the assembled DSN touch Terraform state, **state must be SSE-KMS encrypted** (see State backend section). The full `DATABASE_URL` is injected into both the app and migration task definitions via the `secrets` block (`valueFrom` → ARN), never as plaintext env.

### 4.2 ElastiCache Redis (cache + queue)

Redis is a **first-class tier**, not an afterthought: it backs both `CACHE_STRATEGY=redis` and `@open-mercato/queue`. A single connection string (`CACHE_REDIS_URL`) serves both; there is no separate queue broker.

| Setting | dev | prod | Driven by |
|---|---|---|---|
| Topology | single node (`cache_cluster`) | replication group | `redis_multi_az` |
| Node type | `cache.t4g.micro` | `m7g.large` | `redis_node_type` |
| Replicas | 0 | 1–2 | `redis_replica_count` |
| Multi-AZ + auto-failover | off | **on** | `redis_multi_az` |
| Encryption in transit (TLS) | on | on | always |
| Encryption at rest (KMS) | on | on | `kms_key_arn` |

```hcl
resource "aws_elasticache_replication_group" "this" {
  replication_group_id       = "${var.name_prefix}-redis"
  description                = "Open Mercato cache + queue"
  engine                     = "redis"
  node_type                  = var.redis_node_type
  num_cache_clusters         = var.redis_multi_az ? (1 + var.redis_replica_count) : 1
  multi_az_enabled           = var.redis_multi_az
  automatic_failover_enabled = var.redis_multi_az

  transit_encryption_enabled = true
  at_rest_encryption_enabled = true
  kms_key_id                 = var.kms_key_arn
  auth_token                 = random_password.redis_auth.result   # required when TLS is on

  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.redis.id]
}
```

Using a replication group in both envs (dev = `num_cache_clusters = 1`, no failover) keeps the resource shape identical across envs — the HA flags are the only delta, set by `redis_multi_az`.

#### `CACHE_REDIS_URL` assembly

TLS is on in both envs, so the scheme is `rediss://` and the auth token is supplied. The token is TF-generated and stored in Secrets Manager:

```hcl
resource "aws_secretsmanager_secret_version" "cache_redis_url" {
  secret_id = aws_secretsmanager_secret.cache_redis_url.id
  secret_string = format(
    "rediss://:%s@%s:6379",
    random_password.redis_auth.result,
    aws_elasticache_replication_group.this.primary_endpoint_address,
  )
}
```

The app points at the **primary endpoint** (`primary_endpoint_address`); on prod failover ElastiCache repoints it automatically, so the URL is stable. Injected into the task definition via `secrets` (`valueFrom` → ARN) as `CACHE_REDIS_URL`; the companion `CACHE_STRATEGY=redis` and `ENABLE_CRUD_API_CACHE` ride as plain env.

### 4.3 Subnet groups & security groups

Both backends sit in **private subnets** with dedicated subnet groups spanning the env's AZs (so Aurora readers and Redis replicas can be placed cross-AZ in prod):

```hcl
resource "aws_db_subnet_group" "aurora" {
  name       = "${var.name_prefix}-aurora"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "${var.name_prefix}-redis"
  subnet_ids = var.private_subnet_ids
}
```

Security groups are **least-privilege and app-scoped** — neither backend accepts traffic from anywhere except the app task SG:

```hcl
resource "aws_security_group_rule" "aurora_from_app" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = aws_security_group.aurora.id
  source_security_group_id = aws_security_group.app.id
}

resource "aws_security_group_rule" "redis_from_app" {
  type                     = "ingress"
  from_port                = 6379
  to_port                  = 6379
  protocol                 = "tcp"
  security_group_id        = aws_security_group.redis.id
  source_security_group_id = aws_security_group.app.id
}
```

The migration one-off task reuses the app SG (or a sibling with the same ingress grants) so the bootstrap `CREATE EXTENSION` and `yarn db:migrate` can reach Aurora through the same 5432 rule. No public ingress, no CIDR allow-lists — only the app/migration SG.

---

## 5. Compute — ECS Fargate (App, Meilisearch, Migration task), ECR, Autoscaling

All compute runs on **Fargate** (no EC2, no Auto Scaling Groups). One ECS cluster per env with **Container Insights** enabled. Three distinct task families share the cluster: the stateless **app service**, the single-task **Meilisearch service**, and the one-off **migration task**. Economy-vs-HA is driven entirely by variable values from the module — never by `count` hacks.

### 5.1 ECS Cluster

```hcl
resource "aws_ecs_cluster" "this" {
  name = "${var.name_prefix}-cluster"
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}
```

One cluster, both envs. CloudWatch log groups are per-service (see Observability) with retention tiered dev 7d / prod 30–90d.

### 5.2 ECR Repository + Lifecycle

The module creates a **private ECR repo** for the app image. Image build/push is **external** (CI builds the Dockerfile and pushes a tag); Terraform only owns the repo and its retention policy. `app_image_tag` is a module variable that also **keys the migration trigger** (§4/§5.5).

```hcl
resource "aws_ecr_repository" "app" {
  name                 = "${var.name_prefix}-app"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "KMS"; kms_key = var.kms_key_arn }
}

resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged + keep last N tagged"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = var.ecr_keep_last_images }
      action       = { type = "expire" }
    }]
  })
}
```

`var.app_image_tag` resolves to `${aws_ecr_repository.app.repository_url}:${var.app_image_tag}` for every task definition below.

### 5.3 App Service (Fargate, private subnets, ALB target)

The app container is **stateless** — `init-or-migrate.sh` and its volume marker are *never* run here (that races across N tasks). The container **command is overridden to `yarn start` only**; migrations are externalized to §5.5. Tasks run in **private subnets**, register into the ALB target group (§7), and reach Aurora/Redis/Meili/EFS via their app-SG ingress rules. No public IP; egress via NAT.

| Setting | dev | prod |
|---|---|---|
| `app_cpu` / `app_memory` | 512 / 1024 | 1024 / 2048 (or higher) |
| `app_desired_count` | 1 | ≥ 2 (across AZs) |
| `app_autoscaling_max` | 1 (effectively off) | e.g. 6 |
| Subnets | private | private (multi-AZ) |

```hcl
resource "aws_ecs_task_definition" "app" {
  family                   = "${var.name_prefix}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.app_cpu
  memory                   = var.app_memory
  execution_role_arn       = aws_iam_role.task_execution.arn   # pulls ECR + reads Secrets/KMS
  task_role_arn            = aws_iam_role.app_task.arn          # ambient S3 (§3), least-privilege

  container_definitions = jsonencode([{
    name      = "app"
    image     = "${aws_ecr_repository.app.repository_url}:${var.app_image_tag}"
    command   = ["yarn", "start"]            # command overridden; no migrate/init here
    essential = true
    portMappings = [{ containerPort = 3000, protocol = "tcp" }]
    environment = local.app_environment       # plaintext, non-secret (§5.6)
    secrets     = local.app_secrets           # valueFrom -> Secrets Manager ARNs (§5.6)
    logConfiguration = { logDriver = "awslogs", options = {
      "awslogs-group" = aws_cloudwatch_log_group.app.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = "app" } }
  }])
}

resource "aws_ecs_service" "app" {
  name                              = "${var.name_prefix}-app"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.app.arn
  desired_count                     = var.app_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration { subnets = var.private_subnet_ids; security_groups = [aws_security_group.app.id]; assign_public_ip = false }
  load_balancer { target_group_arn = var.app_target_group_arn; container_name = "app"; container_port = 3000 }
  depends_on = [null_resource.migrate]        # gate on successful migration (§5.5)
}
```

The `task_role_arn` carries the **ambient S3 least-privilege policy** (Get/Put/Delete/List on the one env bucket) so `storage-s3` authMode `ambient` resolves via the ECS task role.

### 5.4 App Autoscaling (prod)

Target-tracking on **CPU** and **`ALBRequestCountPerTarget`**. In dev, `app_autoscaling_max = 1` makes this a no-op.

```hcl
resource "aws_appautoscaling_target" "app" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.this.name}/${aws_ecs_service.app.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.app_desired_count
  max_capacity       = var.app_autoscaling_max
}

resource "aws_appautoscaling_policy" "cpu" {
  name = "${var.name_prefix}-app-cpu"; policy_type = "TargetTrackingScaling"
  resource_id = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification { predefined_metric_type = "ECSServiceAverageCPUUtilization" }
    target_value = 60
  }
}

resource "aws_appautoscaling_policy" "alb_rps" {
  name = "${var.name_prefix}-app-rps"; policy_type = "TargetTrackingScaling"
  resource_id = aws_appautoscaling_target.app.resource_id
  scalable_dimension = aws_appautoscaling_target.app.scalable_dimension
  service_namespace  = aws_appautoscaling_target.app.service_namespace
  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label = var.alb_request_count_resource_label   # "<alb>/<tg>" pair
    }
    target_value = var.app_target_requests_per_target          # e.g. 1000
  }
}
```

### 5.5 Migration One-Off Task

A **dedicated migration task definition** — same image as the app, different command — runs:
- `yarn mercato init` on first bootstrap, `yarn db:migrate` on subsequent deploys;
- pre-creates the `vector` and `pgcrypto` extensions using the **Aurora master role** (the search/pgvector driver issues `CREATE EXTENSION` at runtime, but the extensions must exist with sufficient privilege first).

It is **not** a long-running service — it's invoked via `aws ecs run-task` from a Terraform `null_resource` + `local-exec`, **keyed on `app_image_tag`** so it only re-runs when the image changes, with a waiter that **fails the apply on non-zero exit**. The app service `depends_on` this resource.

> **Caveat (document it):** `terraform apply` now depends on a successful migration run. A failed migration fails the apply and blocks the app rollout — by design.

```hcl
resource "null_resource" "migrate" {
  triggers = { image = var.app_image_tag }     # re-run only when image changes
  provisioner "local-exec" {
    command = <<-EOT
      set -e
      TASK_ARN=$(aws ecs run-task --cluster ${aws_ecs_cluster.this.name} \
        --task-definition ${aws_ecs_task_definition.migrate.arn} \
        --launch-type FARGATE --region ${var.region} \
        --network-configuration '${local.migrate_network_config}' \
        --query 'tasks[0].taskArn' --output text)
      aws ecs wait tasks-stopped --cluster ${aws_ecs_cluster.this.name} --tasks "$TASK_ARN" --region ${var.region}
      CODE=$(aws ecs describe-tasks --cluster ${aws_ecs_cluster.this.name} --tasks "$TASK_ARN" \
        --region ${var.region} --query 'tasks[0].containers[0].exitCode' --output text)
      test "$CODE" = "0"
    EOT
  }
}
```

The migration task definition reuses the same `environment` + `secrets` (it needs `DATABASE_URL`) but overrides `command` (e.g. `["yarn", "db:migrate"]` / `["yarn", "mercato", "init"]`) and uses an execution role permitted to reach Aurora as the master role for extension creation. It runs in **private subnets** with the app SG.

### 5.6 Task Definition — env vs secrets structure

Two disjoint blocks. **Plaintext** non-sensitive config goes in `environment`; **everything sensitive** is injected via `secrets` with `valueFrom` pointing at a Secrets Manager ARN (TF-generated secrets and manually-filled placeholders alike — §10). The app SG-level ambient S3 means **no S3 access keys** appear anywhere.

```hcl
locals {
  app_environment = [
    { name = "PORT",                            value = "3000" },
    { name = "NODE_ENV",                        value = "production" },
    { name = "APP_URL",                         value = var.app_url },
    { name = "PLATFORM_DOMAINS",                value = var.platform_domains },
    { name = "CACHE_STRATEGY",                  value = "redis" },
    { name = "ENABLE_CRUD_API_CACHE",           value = "true" },
    { name = "MEILISEARCH_HOST",                value = local.meili_internal_url },
    { name = "MEILISEARCH_INDEX_PREFIX",        value = var.meili_index_prefix },
    { name = "TENANT_DATA_ENCRYPTION",          value = "true" },
    { name = "OM_ENABLE_STORAGE_S3",            value = "true" },
    { name = "OM_INTEGRATION_STORAGE_S3_REGION",value = var.region },
    { name = "OM_INTEGRATION_STORAGE_S3_BUCKET",value = aws_s3_bucket.attachments.bucket }, # ambient: no keys
    { name = "EMAIL_FROM",                      value = var.email_from },
    { name = "DEMO_MODE",                       value = var.demo_mode },          # false in prod
    { name = "SELF_SERVICE_ONBOARDING_ENABLED", value = var.self_service_onboarding },
    { name = "ADMIN_EMAIL",                     value = var.admin_email },
    # NEW_RELIC_* injected only when enabled; empty/absent by default
  ]

  app_secrets = [
    { name = "DATABASE_URL",                       valueFrom = aws_secretsmanager_secret.database_url.arn },
    { name = "JWT_SECRET",                         valueFrom = aws_secretsmanager_secret.jwt_secret.arn },
    { name = "CACHE_REDIS_URL",                    valueFrom = aws_secretsmanager_secret.redis_url.arn },
    { name = "MEILISEARCH_API_KEY",                valueFrom = aws_secretsmanager_secret.meili_key.arn },
    { name = "TENANT_DATA_ENCRYPTION_KEY",         valueFrom = aws_secretsmanager_secret.tenant_enc_key.arn },
    { name = "TENANT_DATA_ENCRYPTION_FALLBACK_KEY",valueFrom = aws_secretsmanager_secret.tenant_enc_fallback.arn },
    { name = "RESEND_API_KEY",                     valueFrom = aws_secretsmanager_secret.resend_api_key.arn },   # placeholder, filled OOB
    { name = "ANTHROPIC_API_KEY",                  valueFrom = aws_secretsmanager_secret.anthropic_api_key.arn },# placeholder
    { name = "OPENAI_API_KEY",                     valueFrom = aws_secretsmanager_secret.openai_api_key.arn },   # placeholder
    { name = "GOOGLE_GENERATIVE_AI_API_KEY",       valueFrom = aws_secretsmanager_secret.google_ai_key.arn },   # placeholder
    # NEW_RELIC_LICENSE_KEY -> optional Secrets Manager entry, wired only when enabled
  ]
}
```

The **execution role** is granted `secretsmanager:GetSecretValue` + `kms:Decrypt` (customer-managed key) for exactly these ARNs so ECS can resolve `valueFrom` at task launch.

### 5.7 Meilisearch Service (Fargate + EFS)

OSS Meilisearch **cannot cluster** → a **single Fargate task**, `desired_count = 1`, persisting to an **EFS volume mounted at `/meili_data`** via an EFS access point. Not HA; recovery = **reindex from Postgres** (prod may schedule a dump-to-S3). The app tolerates Meili downtime, and ECS auto-restarts the task on failure.

```hcl
resource "aws_efs_file_system" "meili" {
  encrypted = true; kms_key_id = var.kms_key_arn
  lifecycle_policy { transition_to_ia = "AFTER_30_DAYS" }
}

resource "aws_efs_access_point" "meili" {
  file_system_id = aws_efs_file_system.meili.id
  posix_user { uid = 1000; gid = 1000 }
  root_directory { path = "/meili"; creation_info { owner_uid = 1000; owner_gid = 1000; permissions = "0755" } }
}

resource "aws_ecs_task_definition" "meili" {
  family                   = "${var.name_prefix}-meili"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.meili_cpu
  memory                   = var.meili_memory     # var.meili_instance drives sizing per env
  volume {
    name = "meili-data"
    efs_volume_configuration {
      file_system_id = aws_efs_file_system.meili.id
      transit_encryption = "ENABLED"
      authorization_config { access_point_id = aws_efs_access_point.meili.id; iam = "ENABLED" }
    }
  }
  container_definitions = jsonencode([{
    name  = "meilisearch"
    image = "getmeili/meilisearch:v1.x"
    environment = [{ name = "MEILI_ENV", value = "production" }]
    secrets     = [{ name = "MEILI_MASTER_KEY", valueFrom = aws_secretsmanager_secret.meili_key.arn }]
    mountPoints = [{ sourceVolume = "meili-data", containerPath = "/meili_data" }]
    portMappings = [{ containerPort = 7700 }]
    logConfiguration = { logDriver = "awslogs", options = { "awslogs-group" = aws_cloudwatch_log_group.meili.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = "meili" } }
  }])
}
```

The Meili service runs in **private subnets** with its own SG; only the **app SG** is allowed inbound on **7700** (and the EFS SG allows the app/meili SGs on **2049**). The app reaches it via `local.meili_internal_url` (service discovery or internal endpoint).

> **EFS is Meili-only.** App attachments go to **S3** via `storage-s3` (ambient) — the app tasks mount **no EFS** and hold no persistent volume, which is what keeps them stateless and freely scalable.

### 5.8 Summary of compute variables

| Variable | Purpose | dev | prod |
|---|---|---|---|
| `app_cpu` / `app_memory` | App task size | 512 / 1024 | 1024 / 2048+ |
| `app_desired_count` | Baseline app tasks | 1 | ≥ 2 |
| `app_autoscaling_max` | Scale ceiling | 1 | e.g. 6 |
| `app_target_requests_per_target` | ALB RPS target | — | e.g. 1000 |
| `meili_instance` (→ `meili_cpu`/`meili_memory`) | Meili task size | minimal | larger |
| `app_image_tag` | App image tag + migration trigger key | per build | per build |
| `ecr_keep_last_images` | ECR retention | small | small |

---

## 6. Security, Secrets & IAM (incl. ambient S3 task role)

This section defines the secret material, the customer-managed KMS key that wraps it, and the two-role IAM split that ECS uses — including why the **app task role itself is the ambient S3 credential**.

### 6.1 KMS customer-managed key

A single customer-managed KMS key (CMK) is provisioned per env and used to encrypt:

- All Secrets Manager entries (`kms_key_id` on every secret).
- Aurora storage and ElastiCache at-rest encryption.
- CloudWatch Logs groups (optional, prod).

The CMK key policy grants `kms:Decrypt` to the **execution role** (to resolve `secrets` at task launch) and to the AWS services that need envelope encryption (`secretsmanager`, `rds`, `elasticache`, `logs`) via service-principal conditions. No `kms:*` wildcards on task roles.

### 6.2 Secrets: TF-generated vs manual placeholders

Two classes of Secrets Manager entries. The distinction is **whether the value ever touches Terraform state**.

**TF-generated** (via `random_password` → `aws_secretsmanager_secret_version`). These land in state, which is exactly why the [state backend is SSE-KMS encrypted + versioned](#) (decision 12):

```hcl
resource "random_password" "jwt_secret"          { length = 64; special = false }
resource "random_password" "tenant_enc_key"      { length = 64; special = false }
resource "random_password" "tenant_enc_fallback" { length = 64; special = false }
resource "random_password" "meili_master_key"    { length = 48; special = false }
resource "random_password" "aurora_password"     { length = 32; special = true; override_special = "!#$%^&*()-_" }

resource "aws_secretsmanager_secret" "jwt_secret" {
  name       = "${var.name_prefix}/JWT_SECRET"
  kms_key_id = aws_kms_key.main.arn
}
resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}
```

Covers: `JWT_SECRET`, `TENANT_DATA_ENCRYPTION_KEY`, `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`, the Meilisearch master key (`MEILISEARCH_API_KEY`, also consumed by the Meili task as `MEILI_MASTER_KEY`), and the Aurora master password (also assembled into `DATABASE_URL` / `CACHE_REDIS_URL` is built from the ElastiCache endpoint).

**Manual placeholders** (created empty by TF, filled out-of-band so they never enter state):

```hcl
locals {
  placeholder_secrets = [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY",
    "RESEND_API_KEY",
  ]
}
resource "aws_secretsmanager_secret" "placeholder" {
  for_each   = toset(local.placeholder_secrets)
  name       = "${var.name_prefix}/${each.value}"
  kms_key_id = aws_kms_key.main.arn
}
# NOTE: no secret_version resource — values are set manually via
#   aws secretsmanager put-secret-value --secret-id <arn> --secret-string <value>
# TF must ignore_changes on the version, or omit it entirely, so applies don't blank them.
```

`NEW_RELIC_LICENSE_KEY` follows the same placeholder pattern, gated behind the New Relic variable (decision 17). `EMAIL_FROM`, `PLATFORM_DOMAINS`, `ADMIN_EMAIL` are plain (non-secret) task-def env, not Secrets Manager entries.

> **State-secret caveat (call out in the runbook):** Because the five TF-generated secrets exist in plaintext inside Terraform state, the state bucket MUST stay SSE-KMS encrypted, versioned, and access-restricted (decision 12). Anyone with `s3:GetObject` on the state object can read these secrets. Rotating any of them is a manual `put-secret-value` + ECS service redeploy; rotating `TENANT_DATA_ENCRYPTION_KEY` requires the fallback-key re-baseline flow, never a hard swap.

### 6.3 IAM: execution role vs task role

Two distinct roles per ECS service — do not collapse them.

**ECS task EXECUTION role** (used by the ECS agent at launch, not by app code):

- `AmazonECSTaskExecutionRolePolicy` (ECR pull + CloudWatch Logs `CreateLogStream`/`PutLogEvents`).
- `secretsmanager:GetSecretValue` on the specific secret ARNs in this env's `name_prefix`.
- `kms:Decrypt` on the CMK (to unwrap those secrets).

**ECS TASK role** (the running app's AWS identity — the **ambient credential**):

- Least-privilege S3 on the **one** attachments bucket for this env, nothing else:

```hcl
data "aws_iam_policy_document" "app_task_s3" {
  statement {
    actions = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.attachments.arn}/*"]
  }
  statement {
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.attachments.arn]
  }
}
```

The app reaches this via the AWS SDK default credential chain → ECS container-credentials endpoint → task role. No access keys are minted, stored, or rotated. The Meilisearch task and the migration one-off task get their own scoped task roles (Meili: none beyond logs unless the prod dump-to-S3 is enabled; migration task: Secrets Manager read for the Aurora master + `DATABASE_URL` assembly only).

### 6.4 Ambient S3: the one-time post-deploy step

`storage-s3` selects its driver and credential mode **per `AttachmentPartition` in the DB**, not purely from env. The env preset only expresses `authMode: 'access_keys'`, so to use the task role (`'ambient'`) there is a mandatory one-time, per-scope post-deploy action:

1. Confirm task env is set: `OM_ENABLE_STORAGE_S3=true`, `OM_INTEGRATION_STORAGE_S3_REGION`, `OM_INTEGRATION_STORAGE_S3_BUCKET`, and **no** access-key env.
2. In the marketplace/integrations UI, open the **storage_s3** integration for the target scope and set **authMode: `ambient`** (and bucket/region) so the persisted `AttachmentPartition` config uses the default credential chain.
3. Upload a test attachment; confirm the object lands in the env bucket and that no access-key secret exists.

Run this once per env after the first successful deploy. It is the only manual config step in the bootstrap that touches application data rather than infra.

> **Future enhancement (tracked, not in this release):** add an upstream `OM_INTEGRATION_STORAGE_S3_AUTH_MODE` knob so the env preset can express `ambient` directly. Once that lands, step 6.4 becomes fully env-automatable and this manual marketplace action is dropped from the runbook.

### 6.5 WAF (optional)

AWS WAF is an **opt-in seam**, off by default. When enabled via variable, attach a `waf_v2` web ACL (AWS managed core rule set + rate-based rule) to the ALB. Left unset, the ALB serves directly behind ACM/443 with no WAF — acceptable for the platform-domain-only ingress (decision 7), and trivially switchable later without touching the ECS/Aurora wiring.

---

## 7. Deploy Sequence, Bootstrap & Operational Runbook

This section defines the exact ordering for standing up and operating the platform. The hard rule throughout: **app tasks are stateless and run `yarn start` only** — all schema/extension/seed work happens in the dedicated one-off migration task, and the Terraform migration trigger gates the app rollout.

### A. One-Time Bootstrap (manual, pre-Terraform)

These resources either can't bootstrap themselves (state backend) or must never enter state (third-party keys). Do them once per AWS account/env, out of band.

1. **State backend (per env, pre-exists the module).**
   - Create an S3 state bucket: versioning ON, SSE-KMS with a customer-managed key, public access blocked.
   - Native S3 lockfile locking — **no DynamoDB table**. One state key per env.
   - Wire the live layer to it:
     ```hcl
     # live/prod/backend.tf
     terraform {
       backend "s3" {
         bucket       = "om-tfstate-prod"
         key          = "open-mercato/prod.tfstate"
         region       = "<region>"
         kms_key_id   = "<cmk-arn>"
         encrypt      = true
         use_lockfile = true   # native S3 locking
       }
     }
     ```
   - TF-generated secrets (JWT_SECRET, TENANT_DATA_ENCRYPTION_KEY + fallback, Meili master key, Aurora password) touch state — this encrypted backend is the reason they're safe to generate.

2. **First `terraform apply` to create ECR + secret scaffolding only is *not* required separately** — ECR repo and the empty third-party secret placeholders are created by the module on the first full apply (step B1). But because the first image must exist *before* the app service can pull, do the following ordering:
   - Run a **scoped first apply** targeting just ECR so the repo exists:
     ```bash
     terraform apply -target=module.open_mercato.aws_ecr_repository.app
     ```
   - Build and push the first image to that repo:
     ```bash
     docker build -t $ECR/app:<tag> .
     aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin $ECR
     docker push $ECR/app:<tag>
     ```
   - Set `app_image_tag = "<tag>"` in `environments/<env>.tfvars`.

3. **Fill manual secret placeholders (out-of-band, never in state).** The module creates these as **empty** Secrets Manager entries: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `RESEND_API_KEY`, `EMAIL_FROM`, and the optional `NEW_RELIC_*` entry. Populate the ones you use:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id om/prod/RESEND_API_KEY --secret-string '<key>'
   aws secretsmanager put-secret-value \
     --secret-id om/prod/EMAIL_FROM --secret-string 'no-reply@<platform-domain>'
   ```
   Leave AI keys empty if unused — the app tolerates empty values. New Relic stays OFF unless its secret is filled and the variable enabled.

4. **ACM certificate (pre-validated).** The module *takes* `acm_certificate_arn` and makes **zero DNS changes**. Validate the cert (DNS-validated in your own Route 53 or registrar) before apply. After apply, point your platform DNS record at the module's `alb_dns_name` output.

### B. First Deploy Sequence

Strict ordering. Each arrow is a gate.

```
terraform apply
  └─> infra (VPC/SGs/ALB/Aurora/Redis/Meili/EFS/ECR/secrets/task defs)
       └─> migration run-task (null_resource → aws ecs run-task + waiter)
            • CREATE EXTENSION vector, pgcrypto   (Aurora master role)
            • yarn mercato init  (schema + seed, FIRST bootstrap only)
            └─> [exit 0 gates the next step; non-zero FAILS the apply]
                 └─> app ECS service update → tasks come up on `yarn start`
                      └─> ALB targets healthy
```

1. **`terraform apply`** in `live/<env>` with `environments/<env>.tfvars`. This builds all infra, the empty third-party secrets, the ECR repo (idempotent), and **both task definitions**: the app task (command overridden to `yarn start`) and the one-off migration task.

2. **Migration run-task fires automatically** via the trigger described in decision 5 — a `null_resource` whose `triggers` key on `app_image_tag` runs `aws ecs run-task --wait` against the migration task definition:
   ```hcl
   resource "null_resource" "migrate" {
     triggers = { image = var.app_image_tag }
     provisioner "local-exec" {
       command = <<-EOT
         TASK_ARN=$(aws ecs run-task --cluster ${local.cluster} \
           --task-definition ${aws_ecs_task_definition.migrate.arn} \
           --launch-type FARGATE --network-configuration '${local.net_cfg}' \
           --query 'tasks[0].taskArn' --output text)
         aws ecs wait tasks-stopped --cluster ${local.cluster} --tasks $TASK_ARN
         CODE=$(aws ecs describe-tasks --cluster ${local.cluster} --tasks $TASK_ARN \
           --query 'tasks[0].containers[0].exitCode' --output text)
         test "$CODE" = "0"
       EOT
     }
   }
   # app service depends_on null_resource.migrate
   ```
   The migration task pre-creates `vector` + `pgcrypto` using the Aurora master role, then runs `yarn mercato init` (first bootstrap) — **not** `docker/scripts/init-or-migrate.sh` (its volume marker file races across tasks and is forbidden on Fargate). On first bootstrap this also applies the initial seed and the `ADMIN_EMAIL` admin.

   > **Caveat (decision 5):** `terraform apply` now depends on a successful migration run. A failing migration fails the apply and the app service is **not** updated — this is intentional fail-closed behavior.

3. **App service comes up.** ECS rolls the app service to `app_desired_count` tasks running `yarn start`. Wait for ALB target health before treating the deploy as live.

4. **Post-deploy (one-time, manual).**
   - **Set storage_s3 to ambient.** The env preset only expresses `access_keys`, so flip the integration to `authMode: ambient` once per scope via the marketplace UI (this makes the storage driver use the AWS default chain = the ECS task role; no access keys in env). Future seam: an upstream `OM_INTEGRATION_STORAGE_S3_AUTH_MODE` knob would make this fully env-automatable.
   - **Verify attachments → S3.** Upload an attachment through the app; confirm the object lands in the env's single bucket (`OM_INTEGRATION_STORAGE_S3_BUCKET`) and the task role's least-privilege Get/Put/Delete/List is sufficient.
   - **Verify search.** Trigger a reindex from Postgres and confirm Meilisearch is populated and queryable; confirm `MEILISEARCH_INDEX_PREFIX` matches the env.
   - **Prod safety flags.** Confirm `DEMO_MODE=false` and set `SELF_SERVICE_ONBOARDING_ENABLED` to the intended value for prod (typically OFF for a controlled platform, ON only if public self-service signup is desired). Confirm `NODE_ENV=production`, `APP_URL`/`PLATFORM_DOMAINS` resolve to the live cert's domain.

### C. Routine Deploy

```
build + push app:<new_tag>
  └─> set app_image_tag=<new_tag> in <env>.tfvars
       └─> terraform apply
            └─> trigger sees image change → migration run-task (db:migrate)
                 └─> exit 0 → app service rolling update to <new_tag>
```

1. Build and push the new image under a new `app_image_tag`.
2. Bump `app_image_tag` in `environments/<env>.tfvars`, `terraform apply`.
3. The migration trigger re-fires **only because `app_image_tag` changed** (its `triggers` key). On a non-first deploy the migration task runs **`yarn db:migrate`** (idempotent forward migrations), not `init`. Extension creation is idempotent (`CREATE EXTENSION IF NOT EXISTS`) and stays in the task.
4. On migration exit 0, ECS performs a rolling update of the app service (prod: `minHealthyPercent`/`maxPercent` keep ≥2 tasks across AZs healthy). A failed migration aborts the apply and leaves the running app on the previous tag.

> Meilisearch and Redis task definitions are unaffected by routine app deploys unless their own variables change.

### D. Recovery

- **Meilisearch (no HA by design).** OSS Meili can't cluster. The single Fargate task auto-restarts; EFS at `/meili_data` survives task replacement. If the index is lost or corrupted, **reindex from Postgres** (Postgres is the source of truth) — same reindex command as the first-deploy verification step. Prod optionally restores from the scheduled dump-to-S3 to shorten reindex time. The app tolerates Meili downtime, so this is non-blocking for the rest of the platform.
- **Aurora PITR.** Restore to a new cluster from automated backups / PITR within the retention window (prod 7–30d, KMS-encrypted, deletion protection ON). Point `DATABASE_URL` at the restored cluster (update the Aurora password secret if rotated), re-run the migration task to confirm schema + extensions, then roll the app. Aurora Serverless v2 in prod has a writer + ≥1 reader in another AZ with Multi-AZ failover, so most instance-level failures recover automatically without PITR.
- **Redis.** Prod is a Multi-AZ replication group with automatic failover (cache is rebuildable; no PITR needed). Dev is a single `cache.t4g.micro` with no replica — on loss, the node is recreated and the cache repopulates cold.

### E. Dev vs Prod Operational Differences

| Concern | dev | prod |
|---|---|---|
| Aurora | single instance, 0.5–2 ACU, single-AZ, no deletion protection | writer + ≥1 reader (other AZ), 2–16 ACU autoscaling, Multi-AZ failover, deletion protection ON, PITR 7–30d |
| Redis | single `cache.t4g.micro`, no replica/Multi-AZ | replication group, Multi-AZ + auto failover, `m7g.large`, 1–2 replicas, encryption in transit + at rest |
| App tasks | `app_desired_count=1`, minimal sizes | `app_desired_count≥2` across AZs, target-tracking autoscaling (CPU + ALB request count) |
| NAT | `single_nat_gateway=true` (one NAT GW) | one NAT GW per AZ |
| Meili | single task + EFS, no dump | single task + EFS, optional scheduled dump-to-S3 |
| Logs retention | 7d | 30–90d |
| Alarms | baseline | baseline (ALB 5xx, target health, Aurora CPU/connections, Redis evictions), watched |
| `DEMO_MODE` | may be `true` | **`false`** |
| `SELF_SERVICE_ONBOARDING_ENABLED` | as needed for testing | deliberate choice (default OFF for controlled platform) |
| New Relic | OFF (empty) | OFF unless secret filled + variable enabled |

All differences are driven by **variable values** in `environments/<env>.tfvars` (decision 11 — no workspaces, no count-hacking). The same module produces both economy-dev and HA-prod; only the inputs change.

---

## 8. Hardening Checklist (applied from consistency review)

These corrections supersede any conflicting illustrative snippet above. They are the authoritative deltas to carry into the real Terraform.

### Networking / Security Groups
- **Meilisearch gets its own SG** (`meili`), not the shared app SG. Add an explicit ingress rule: `meili` SG **7700 from `app` SG only**. Reconciles §3.3 ↔ §5.7.
- **EFS SG (2049)** must allow inbound from **both** the `app` SG and the `meili` SG (the Meili task is the actual NFS client; app does not mount EFS).
- **EFS mount targets are mandatory** — one `aws_efs_mount_target` per private-subnet AZ, attached to the `efs` SG. Without them the access point is unreachable. (Missing in §5.7's snippet.)
- App SG egress stays `all` for simplicity; if you want strict least-privilege egress, scope it to Aurora 5432 / Redis 6379 / Meili 7700 / EFS 2049 / 443 to NAT+endpoints.

### Fargate + EFS
- **Pin `platform_version = "1.4.0"`** (or later) on the Meili service **and** on the migration `aws ecs run-task` call — Fargate EFS volumes require platform 1.4.0+.

### Migration waiter (decisions 4 & 5) — harden the `local-exec`
Replace the naive `test "$CODE" = "0"` with start-failure + log-pointer handling:
```bash
set -euo pipefail
TASK_ARN=$(aws ecs run-task --cluster "$CLUSTER" \
  --task-definition "$MIGRATE_TASKDEF" --launch-type FARGATE \
  --platform-version 1.4.0 --region "$REGION" \
  --network-configuration "$NET_CFG" \
  --started-by "tf-migrate-${IMAGE_TAG}" \
  --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION"
CODE=$(aws ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK_ARN" --region "$REGION" \
  --query 'tasks[0].containers[0].exitCode' --output text)
if [ "$CODE" != "0" ]; then
  echo "Migration FAILED (exitCode=$CODE). Task: $TASK_ARN"
  echo "Logs: CloudWatch group $MIGRATE_LOG_GROUP, stream prefix 'migrate'"
  exit 1
fi
```
- Handle `exitCode == None` (image-pull / SG / subnet start failure) — `None != 0` so the guard above already fails, but the echoed log-group pointer is what makes it diagnosable.
- **Concurrency:** the marker-file guard is intentionally absent on Fargate, so two simultaneous applies could launch two `db:migrate` tasks. Run applies **serially per env** (the S3 native state lock already serializes a single env's applies; just don't bypass it). For extra safety, wrap migrations in a Postgres advisory lock.

### Secrets (§6.2) — corrections
- **One Aurora password resource only:** keep `random_password.aurora` with `special = false` (DSN-safe). Delete the duplicate `random_password.aurora_password` (`special = true`) — mixed URL-reserved chars break the `DATABASE_URL` DSN.
- **Enumerate `random_password.redis_auth`** in the TF-generated list (it's used in §4.2's `rediss://` URL assembly but was missing from §6.2). ElastiCache `auth_token` must be **16–128 chars**, limited specials — generate accordingly (`length = 64`, `override_special` excluding `@/:`).
- **`EMAIL_FROM` is plain task-def env, NOT a Secrets Manager placeholder.** Remove it from the manual-placeholder list in §A.3 / §6.2. Manual placeholders are exactly: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `RESEND_API_KEY` (+ optional `NEW_RELIC_LICENSE_KEY`).

### IAM (§6.3)
- **App task-role S3 policy** must also include `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts` (on `<bucket>/*`) and `s3:GetBucketLocation` (on `<bucket>`) — large/multipart attachment uploads fail under ambient auth without them.
- **Migration credential clarity:** the migration task reaches Aurora as master via the **`DATABASE_URL` master secret from Secrets Manager**, not via the ECS *execution* role. The execution role only pulls ECR + resolves secrets; the *task* identity + DB credential do the schema/extension work.
- **CMK key policy for encrypted logs:** if CloudWatch log groups are CMK-encrypted (prod), the key policy must grant `logs.<region>.amazonaws.com` `kms:Encrypt*/Decrypt*/ReEncrypt*/GenerateDataKey*/Describe*` with an `ArnLike` condition on the log-group ARN — otherwise the encrypted log group silently fails to create.

### Task definition env (§5.6)
- **`NODE_ENV` must be variable-driven** (`var.node_env`, default `"production"`), not hardcoded — otherwise dev also reports production.
- **Coerce bool vars to strings** in the `environment` block: `value = tostring(var.demo_mode)`, `value = tostring(var.self_service_onboarding)` — ECS `environment.value` must be a string.

### Aurora extension privilege (§4.1)
- Soften the wording: extensions are created by the **`rds_superuser` / master role**, which is permitted to create the allow-listed `vector` and `pgcrypto` extensions. The Aurora master is **not** a true Postgres superuser — don't attempt to grant superuser.

### Redis TLS client (runtime verify)
- `transit_encryption_enabled = true` ⇒ `CACHE_REDIS_URL = rediss://...`. Verify the app's Redis client (ioredis/queue) actually performs TLS cert validation on the `rediss://` scheme; some clients need an explicit `tls: {}` option. Treat as a runtime smoke test during first deploy.

### Health check
- The ALB target health check assumes **`GET /api/health` → 200** exists in the app. Confirm the route is present (or adjust the path) and that `health_check_grace_period_seconds` (60s) covers Next.js cold start; raise it if first-boot is slower.

---

## Appendix — Open Follow-ups

1. **Upstream enhancement (optional):** add `OM_INTEGRATION_STORAGE_S3_AUTH_MODE=ambient` to `readS3EnvPreset` in `packages/storage-s3` so the env preset can express ambient directly — this removes the one manual marketplace step (§6.4) and makes the S3 path 100% Terraform-automatable. Backward-compatible PR.
2. **Custom-domain ingress:** if per-tenant custom domains are later required, the platform domain ALB path does not cover it — revisit the NLB + Traefik (on-demand ACME) seam noted in §3.5.
3. **Prod Meili dump-to-S3:** wire the optional scheduled dump (EventBridge → run-task) to shorten reindex recovery time; left as a variable-gated add-on.
