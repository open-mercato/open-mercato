# Production environment — scale profile (HA: dedicated worker service, multi-AZ data tiers).
region             = "us-east-1"
name_prefix        = "om-prod"
environment        = "prod"
deployment_profile = "scale"

app_url         = "https://app.REPLACE-WITH-DOMAIN"
certificate_arn = "arn:aws:acm:us-east-1:REPLACE:certificate/REPLACE"

image          = "ghcr.io/open-mercato/open-mercato:prod-REPLACE"
s3_bucket_name = "om-prod-storage-REPLACE"

alarm_email = "ops@REPLACE-WITH-DOMAIN"
