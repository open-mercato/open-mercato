# Dev environment — economy profile (lowest cost).
# Fill in the values below, then: terraform init && terraform apply
# NOTE: never put secret VALUES here (this file and state are not a vault).

region             = "us-east-1"
name_prefix        = "om-dev"
environment        = "dev"
deployment_profile = "economy"

# Public URL the app is served on. With certificate_arn empty the ALB is HTTP-only (dev).
app_url         = "http://REPLACE-WITH-ALB-OR-DOMAIN"
certificate_arn = "" # set to an ACM cert ARN to enable HTTPS

# Published production image (root ./Dockerfile runner stage) on GHCR.
image = "ghcr.io/open-mercato/open-mercato:prod-REPLACE"

# Globally-unique bucket name for file storage.
s3_bucket_name = "om-dev-storage-REPLACE"

alarm_email = ""
