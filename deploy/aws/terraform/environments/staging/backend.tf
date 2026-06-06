terraform {
  # Remote state created by deploy/aws/terraform/bootstrap.
  # Replace the bucket (and region) below, or pass them with -backend-config.
  backend "s3" {
    bucket         = "REPLACE-WITH-STATE-BUCKET"
    key            = "env/staging/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "open-mercato-tf-locks"
    encrypt        = true
  }
}
