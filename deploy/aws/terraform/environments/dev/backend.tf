terraform {
  # Remote state created by deploy/aws/terraform/bootstrap.
  # Replace the bucket (and region) below, or pass them with:
  #   terraform init -backend-config=bucket=<state-bucket> -backend-config=region=<region>
  backend "s3" {
    bucket         = "REPLACE-WITH-STATE-BUCKET"
    key            = "env/dev/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "open-mercato-tf-locks"
    encrypt        = true
  }
}
