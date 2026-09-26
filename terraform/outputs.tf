output "spaces_bucket_name" {
  description = "Spaces bucket name for character icon objects."
  value       = digitalocean_spaces_bucket.character_icons.name
}

output "spaces_bucket_domain_name" {
  description = "Origin FQDN for the Spaces bucket (without CDN)."
  value       = digitalocean_spaces_bucket.character_icons.bucket_domain_name
}

output "spaces_cdn_endpoint" {
  description = "CDN FQDN for public icon URLs (use https:// with object key)."
  value       = digitalocean_cdn.character_icons.endpoint
}

output "spaces_fight_media_bucket_name" {
  description = "Spaces bucket name for fight video and frame objects."
  value       = digitalocean_spaces_bucket.fight_media.name
}

output "spaces_fight_media_bucket_domain_name" {
  description = "Origin FQDN for the fight-media Spaces bucket (without CDN)."
  value       = digitalocean_spaces_bucket.fight_media.bucket_domain_name
}

output "spaces_fight_media_cdn_endpoint" {
  description = "CDN FQDN for public fight video URLs (use https:// with object key)."
  value       = digitalocean_cdn.fight_media.endpoint
}

output "spaces_fight_media_access_key_id" {
  description = "Access key ID for the fight-media bucket-scoped Spaces key. Copy into FIGHT_MEDIA_SPACES_ACCESS_KEY_ID."
  value       = digitalocean_spaces_key.fight_media.access_key
}

output "spaces_fight_media_secret_key" {
  description = "Secret for the fight-media bucket-scoped Spaces key. Copy into FIGHT_MEDIA_SPACES_SECRET. Never commit."
  value       = digitalocean_spaces_key.fight_media.secret_key
  sensitive   = true
}

output "database_host" {
  description = "Public hostname of the Managed PostgreSQL cluster."
  value       = digitalocean_database_cluster.battle_state.host
}

output "database_port" {
  description = "PostgreSQL port."
  value       = digitalocean_database_cluster.battle_state.port
}

output "database_name" {
  description = "Default database name on the cluster."
  value       = digitalocean_database_cluster.battle_state.database
}

output "database_user" {
  description = "Default database user."
  value       = digitalocean_database_cluster.battle_state.user
}

output "database_password" {
  description = "Default database password."
  value       = digitalocean_database_cluster.battle_state.password
  sensitive   = true
}

output "database_uri" {
  description = "PostgreSQL connection URI."
  value       = digitalocean_database_cluster.battle_state.uri
  sensitive   = true
}

output "database_private_uri" {
  description = "Private-network PostgreSQL connection URI."
  value       = digitalocean_database_cluster.battle_state.private_uri
  sensitive   = true
}

output "db_size" {
  description = "Size slug applied to the cluster."
  value       = digitalocean_database_cluster.battle_state.size
}

output "app_id" {
  description = "DigitalOcean App Platform app id (database firewall trusted source)."
  value       = digitalocean_app.game.id
}

output "app_live_url" {
  description = "Public HTTPS URL for the game app (health check at /health)."
  value       = digitalocean_app.game.live_url
}

output "app_default_ingress" {
  description = "Default ingress hostname for the game app."
  value       = digitalocean_app.game.default_ingress
}
