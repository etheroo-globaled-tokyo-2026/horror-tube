terraform {
  required_version = ">= 1.5.0"

  # Remote state in a private DigitalOcean Spaces bucket (S3-compatible).
  # Bucket name and object key live in gitignored backend.hcl (see backend.hcl.example).
  # region = us-east-1 is the AWS SDK dummy Spaces requires; the bucket itself is in sgp1.
  # use_lockfile needs Terraform >= 1.10; this repo pins >= 1.5 and operators may be on
  # 1.9.x — Spaces has no DynamoDB, so there is no state lock on those versions.
  backend "s3" {
    region                      = "us-east-1"
    skip_credentials_validation = true
    skip_metadata_api_check     = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
  }

  required_providers {
    digitalocean = {
      source  = "digitalocean/digitalocean"
      version = "~> 2.102"
    }
  }
}

provider "digitalocean" {
  token = var.do_token
}
