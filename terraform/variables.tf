variable "do_token" {
  description = "DigitalOcean API token. Set via TF_VAR_do_token (or export DIGITALOCEAN_TOKEN and assign it to TF_VAR_do_token). Never commit this value."
  type        = string
  sensitive   = true
}

variable "region" {
  description = "DigitalOcean region for Spaces and Managed PostgreSQL. Must be a Spaces region (e.g. nyc3) that also appears in databases/options for pg."
  type        = string
  default     = "nyc3"
}

variable "spaces_bucket_name" {
  description = "Globally unique Spaces bucket name for character icons. No default — choose a name that does not embed secrets."
  type        = string
}

variable "db_size" {
  description = "Managed PostgreSQL size slug from GET /v2/databases/options (pg layouts). Default verified against the API: db-s-1vcpu-2gb (1 vCPU, 2 GB RAM)."
  type        = string
  default     = "db-s-1vcpu-2gb"
}

variable "db_name" {
  description = "Name of the Managed PostgreSQL cluster."
  type        = string
  default     = "horror-tube-pg"
}

variable "db_engine_version" {
  description = "PostgreSQL major version. Default is the API default from version_availability (18)."
  type        = string
  default     = "18"
}
