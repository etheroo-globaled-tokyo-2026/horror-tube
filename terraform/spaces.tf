# Character icons on Spaces + CDN (issue #5).
# ENS stores only the HTTPS CDN URL; object keys should change when art changes.
# Bucket ACL is public-read. Uploads still require object ACL public-read.
# Upload clients use SPACES_ACCESS_KEY_ID + SPACES_SECRET from the environment
# (no defaults). See README and root .env.example (empty names only).

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

# Fight videos + last frames on Spaces + CDN (issue #52; frames prefix is #53).
# Separate bucket from character_icons. Object keys: videos/<id>.mp4, frames/...
# Upload clients use FIGHT_MEDIA_SPACES_* from the environment (no defaults).
# See README and root .env.example (empty names only).

resource "digitalocean_spaces_bucket" "fight_media" {
  name   = var.spaces_fight_media_bucket_name
  region = var.region
  acl    = "public-read"
}

resource "digitalocean_spaces_bucket_cors_configuration" "fight_media" {
  bucket = digitalocean_spaces_bucket.fight_media.id
  region = digitalocean_spaces_bucket.fight_media.region

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "HEAD"]
    allowed_origins = ["*"]
    max_age_seconds = 3600
  }
}

resource "digitalocean_cdn" "fight_media" {
  origin = digitalocean_spaces_bucket.fight_media.bucket_domain_name
  ttl    = 3600
}

# Bucket-scoped Spaces key (readwrite on fight_media only). Do not widen the icons key.
# secret_key is returned once by the API; store it in 1Password / .env — never commit it.
resource "digitalocean_spaces_key" "fight_media" {
  name = "${digitalocean_spaces_bucket.fight_media.name}-rw"

  grant {
    bucket     = digitalocean_spaces_bucket.fight_media.name
    permission = "readwrite"
  }
}
