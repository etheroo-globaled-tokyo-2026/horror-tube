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
