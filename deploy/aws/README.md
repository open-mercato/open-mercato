# Open Mercato on AWS — Terraform + Runbook

Infrastructure-as-code and an operational runbook to run Open Mercato on AWS using
**ECS Fargate**, **Aurora PostgreSQL Serverless v2**, **ElastiCache for Redis**,
**Meilisearch on Fargate + EFS**, **S3**, and **Secrets Manager**.

> ⚠️ **Draft.** Terraform here was authored but not `terraform validate`-d in CI (no
> Terraform binary in the authoring environment). Run `terraform fmt -recursive` and
> `terraform validate` locally before your first apply. Treat the first `plan` as the
> source of truth and review it carefully.

## Architecture

```
                    Internet
                       │ 443 (ACM/TLS)
                  ┌────▼────┐   public subnets
                  │   ALB   │
                  └────┬────┘
        private subnets│ 3000
        ┌──────────────┼───────────────┐
   ┌────▼────┐   ┌─────▼─────┐   ┌──────▼──────┐
   │ web svc │   │ worker svc│   │ meilisearch │  (ECS Fargate)
   │ yarn    │   │ (scale    │   │  + EFS      │
   │ start   │   │  profile) │   │  index      │
   └────┬────┘   └─────┬─────┘   └─────────────┘
        │ isolated subnets (no internet ingress)
   ┌────▼─────────┬──────────────┬──────────────┐
   │ Aurora PG    │ ElastiCache  │ S3 (task IAM)│
   │ Serverless v2│ Redis (TLS)  │ Secrets Mgr  │
   │ pgcrypto +   │ cache/queue/ │ KMS          │
   │ pgvector     │ events/limit │              │
   └──────────────┴──────────────┴──────────────┘
   egress → NAT (+ S3 gateway / Secrets/Logs/STS interface endpoints)
```

### Two deployment profiles

| | `economy` (dev/staging) | `scale` (prod) |
|---|---|---|
| Web/worker | 1 all-in-one task (`AUTO_SPAWN_WORKERS=true`) | web service + **dedicated worker service** (`AUTO_SPAWN_WORKERS=false`) |
| NAT | 1 (single AZ, SPOF accepted) | 1 per AZ |
| Aurora | 1 instance, 0.5–2 ACU | writer + reader, 2–8 ACU |
| Redis | 1× `t4g.micro`, no failover | `r7g.large` primary+replica, multi-AZ |
| Autoscaling | off | web 2–6, worker 2–6 |
| Deletion protection | off (force-destroy storage) | on |

Set `deployment_profile` per environment. Approx cost: **~$240/mo economy**, **~$1,660/mo
scale** (us-east-1; see the plan's cost section). Non-prod is mostly fixed cost — schedule
it off out of hours to roughly halve it.

## Layout

```
deploy/aws/
  README.md                     # this runbook
  terraform/
    bootstrap/                  # S3 state bucket + DynamoDB lock (run once, local state)
    modules/
      network/ database/ cache/ storage/ secrets/
      ecs-cluster/ app-service/ migration-task/ observability/
      stack/                    # composes everything, profile-driven sizing
    environments/{dev,staging,prod}/   # thin wrappers: backend + tfvars
    shared.tfvars.example       # env-var → secret/param reference
  scripts/                      # seed-secrets.sh migrate.sh deploy.sh logs.sh exec.sh
```

The CI image-publish workflow lives at `.github/workflows/publish-image.yml`.

## Prerequisites

- AWS account + credentials (`aws sts get-caller-identity` works).
- Terraform ≥ 1.5 (or OpenTofu), `awscli` v2, `jq`, Docker (only for local image builds).
- A registered domain + an **ACM certificate** in the deployment region (for HTTPS).
- A **GHCR Personal Access Token** with `read:packages` (to pull the private image).
- The production image published to GHCR (see next section).

## 0. Publish the production image (one-time wiring, then per release)

AWS runs the hardened **`runner`** image from the repo root `./Dockerfile` (CMD `yarn start`,
Next.js build baked in). Publish it to GHCR with the included workflow:

```bash
# Manually, or automatically on a v* tag:
gh workflow run "Publish production image" -f tag=v0.6.3
# -> ghcr.io/open-mercato/open-mercato:prod-<sha> (+ :v0.6.3, :latest on tags)
```

Use that `prod-<sha>` (or `v*`) tag as the `image` input in each environment's tfvars.

> The separate `qa-deploy.yml` builds the **preview/test-harness** image — do **not** use
> it for AWS. If you ever must, set the env's `image` to it and override the web `command`
> to build at startup; expect minutes-long cold starts.

## 1. Bootstrap remote state (once per account/region)

```bash
cd deploy/aws/terraform/bootstrap
terraform init   # local state
terraform apply -var region=us-east-1 -var state_bucket_name=<globally-unique-bucket>
```

Note the outputs (`state_bucket`, `lock_table`), then put the bucket name into each
environment's `backend.tf` (or pass `-backend-config`).

## 2. Provision an environment

```bash
cd deploy/aws/terraform/environments/dev   # or staging / prod
# edit terraform.tfvars: image, app_url, certificate_arn, s3_bucket_name, alarm_email
terraform init -backend-config=bucket=<state-bucket> -backend-config=region=us-east-1
terraform apply
```

This creates the VPC, data tiers, ECS cluster/ALB, services, and the migration task def.
The **web/worker tasks will not be healthy yet** — secrets and the database aren't ready.

## 3. Seed secrets (values never go in Terraform)

Terraform creates secret *containers*; you populate the values out-of-band:

```bash
cd deploy/aws/scripts
./seed-secrets.sh dev     # prompts for JWT_SECRET, AUTH_SECRET,
                          # TENANT_DATA_ENCRYPTION_FALLBACK_KEY, and GHCR creds
# generate strong values:  openssl rand -hex 32
```

`DATABASE_URL`, `REDIS_URL`, and `MEILISEARCH_API_KEY` are generated by Terraform and stored
automatically — you only seed the three app secrets above plus the GHCR pull credentials.

> 🔐 **Residual risk (documented decision):** `TENANT_DATA_ENCRYPTION_FALLBACK_KEY`
> deterministically derives **every** tenant's data-encryption key. A leak decrypts all
> tenant data. This first cut stores it as a plain Secrets Manager secret. **Recommended
> hardening:** back it with a dedicated KMS CMK + CloudTrail, or run HashiCorp Vault
> (`VAULT_ADDR`/`VAULT_TOKEN`) as the app's intended primary key store.

## 4. Database extensions + first init

Aurora's app user can't `CREATE EXTENSION`. Connect once as the master user (from a bastion,
ECS Exec shell, or the migration task) and run:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector, for semantic search
SELECT extname FROM pg_extension;          -- verify
```

Then bootstrap a fresh database and run migrations:

```bash
cd deploy/aws/scripts
./migrate.sh dev init       # first run only: yarn mercato init (seed)
./migrate.sh dev migrate    # idempotent: yarn mercato db migrate
```

`migrate.sh` runs the one-off ECS task and **waits for exit code 0** (fails loudly otherwise).
The web tasks never run migrations themselves — that avoids a multi-task race.

## 5. Go live

```bash
cd deploy/aws/scripts
./logs.sh dev web                 # tail web logs until healthy
terraform -chdir=../terraform/environments/dev output alb_dns_name
```

Point your domain (Route 53 ALIAS / CNAME) at the ALB DNS name. With `certificate_arn` set,
HTTP redirects to HTTPS automatically.

## Day-2 operations

| Task | Command |
|---|---|
| Deploy a new image | `./scripts/deploy.sh <env> ghcr.io/open-mercato/open-mercato:prod-<sha>` |
| Run migrations only | `./scripts/migrate.sh <env> migrate` |
| Tail logs | `./scripts/logs.sh <env> [web\|worker\|meilisearch\|migrate]` |
| Shell into a task | `./scripts/exec.sh <env>` (ECS Exec; needs the SSM Session Manager plugin) |
| Force a redeploy | `aws ecs update-service --cluster <c> --service <s> --force-new-deployment` |
| Rollback | re-apply the previous `image` tag, or `update-service --task-definition <family>:<prevRev>` |
| Flip profile | set `deployment_profile = "scale"` in tfvars → `terraform apply` |

`deploy.sh` applies the new image, runs idempotent migrations, then forces a fresh web
deployment. The ECS **deployment circuit breaker** auto-rolls-back a failing image. For
**destructive** migrations, run `migrate.sh` first in a maintenance window.

### Observability
- **Container Insights** is on; per-service CloudWatch log groups (`<name_prefix>-<service>`)
  have explicit retention.
- CloudWatch **alarms** (ALB 5xx & unhealthy hosts, ECS CPU, RDS CPU/connections, Redis
  memory) publish to an SNS topic; set `alarm_email` to subscribe.

## Security notes (already enforced by the Terraform)

- TLS to Aurora: `rds.force_ssl=1` + app `DB_SSL=true` (ship the RDS CA via `NODE_EXTRA_CA_CERTS`).
- Redis: in-transit + at-rest encryption + AUTH; `REDIS_URL` uses `rediss://`.
- `RATE_LIMIT_STRATEGY=redis` + `RATE_LIMIT_TRUST_PROXY_DEPTH=1` (effective behind the ALB).
- SGs are chained by SG-ID; data tiers accept traffic only from the ECS task SG.
- S3: public access blocked, KMS SSE, TLS-only policy; task **role** access (no static keys).
- EFS encrypted + access point; ALB TLS policy `ELBSecurityPolicy-TLS13-1-2-2021-06`.

### Not included (documented follow-ups)
WAF/CloudFront; dedicated per-domain KMS CMKs + secret rotation; Aurora IAM DB auth; Vault;
mirroring the image to ECR; a GitHub Actions deploy-to-ECS pipeline. See the plan for the
full list.

## S3 credentials caveat

The app's S3 storage module is wired to use the ECS **task role** (no static keys). If your
build of the storage module requires explicit `OM_INTEGRATION_STORAGE_S3_ACCESS_KEY_ID` /
`_SECRET_ACCESS_KEY`, add them as seeded secrets (`extra_seeded_secrets`) and inject them;
otherwise the default AWS credential chain (task role) is used.
