# Terraform remote-state bootstrap

Creates the S3 bucket + DynamoDB lock table used as the remote backend for every
environment. This root uses **local state** (no `backend` block) and is applied once per
AWS account/region.

```bash
terraform init
terraform apply \
  -var region=us-east-1 \
  -var state_bucket_name=<globally-unique-bucket-name>
```

Then set the `bucket` (and `region`) in each `environments/<env>/backend.tf`, or pass them
with `terraform init -backend-config=bucket=<...> -backend-config=region=<...>`.

The local `terraform.tfstate` produced here is small but should be kept (commit to a private
location or store securely) — it tracks the state bucket and lock table themselves.
