variable "do_token" {
  description = "DigitalOcean API token. Set only via TF_VAR_do_token for the terraform command (or rely on DIGITALOCEAN_TOKEN with the provider). Never put this in *.tfvars or commit it."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region for Spaces and Managed PostgreSQL. Must be a Spaces region that also appears in databases/options for pg. For Tokyo hackathons use sgp1 (closest). Required; no default."
  type        = string
}

variable "spaces_bucket_name" {
  description = "Globally unique Spaces bucket name for character icons. Required; no default."
  type        = string
}

variable "spaces_fight_media_bucket_name" {
  description = "Globally unique Spaces bucket name for fight videos and last frames. Required; no default. Must not be the icons bucket."
  type        = string
}

variable "db_size" {
  description = "Managed PostgreSQL size slug from GET /v2/databases/options (pg layouts). Operator must set db-s-1vcpu-2gb (verified against the API). Required; no default and no silent fallback to another size."
  type        = string
}

variable "db_name" {
  description = "Name of the Managed PostgreSQL cluster."
  type        = string
  default     = "horror-tube-pg"
}

variable "db_engine_version" {
  description = "PostgreSQL major version."
  type        = string
  default     = "18"
}
