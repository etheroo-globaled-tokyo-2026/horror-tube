# Character icons on Spaces + CDN (issue #5).
# ENS stores only the HTTPS CDN URL; object keys should change when art changes.
# Bucket ACL is public-read. If a specific object is not readable after upload,
# set that object's ACL to public-read at upload time (see README).

resource "digitalocean_spaces_bucket" "character_icons" {
  name   = var.spaces_bucket_name
  region = var.region
  acl    = "public-read"
}

resource "digitalocean_spaces_bucket_cors_configuration" "character_icons" {
  bucket = digitalocean_spaces_bucket.character_icons.id
  region = digitalocean_spaces_bucket.character_icons.region

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

resource "digitalocean_cdn" "character_icons" {
  origin = digitalocean_spaces_bucket.character_icons.bucket_domain_name
  ttl    = 3600
}
