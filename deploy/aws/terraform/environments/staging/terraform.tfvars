# Staging environment — economy profile by default (bump to "scale" for prod-like load tests).
region             = "us-east-1"
name_prefix        = "om-staging"
environment        = "staging"
deployment_profile = "economy"

app_url         = "https://staging.REPLACE-WITH-DOMAIN"
certificate_arn = "" # set to an ACM cert ARN to enable HTTPS

image          = "ghcr.io/open-mercato/open-mercato:prod-REPLACE"
s3_bucket_name = "om-staging-storage-REPLACE"

alarm_email = ""
