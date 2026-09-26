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

variable "app_name" {
  description = "DigitalOcean App Platform app name. Required; no default."
  type        = string
}

variable "app_region" {
  description = "App Platform region slug from GET /v2/apps/regions (or doctl apps list-regions). Singapore is sgp (datacenter sgp1). Distinct from var.region used by Spaces and Managed Postgres. Required; no default."
  type        = string
}

variable "github_repo" {
  description = "GitHub owner/name for App Platform deploy-on-push. Required; no default. The DigitalOcean team must already have GitHub connected."
  type        = string
}

variable "github_branch" {
  description = "Git branch App Platform builds and redeploys on push. Operator value is main. Required; no default. Override with -var for a one-off deploy of another branch; do not commit a non-main value in terraform.tfvars."
  type        = string
}

variable "instance_size_slug" {
  description = "App Platform instance size slug from https://docs.digitalocean.com/products/app-platform/details/pricing/ (Current Plans API/CLI Slug). Operator must set apps-s-1vcpu-1gb for Node 22 + ffmpeg. Required; no default and no silent fallback."
  type        = string
}

variable "game_port" {
  description = "HTTP listen port for the game service (http_port and GAME_PORT). Required; no default."
  type        = number
}

variable "ens_label" {
  description = "ENS_LABEL baked into the Vite client at image BUILD_TIME (apps/web/game.ts). Set via TF_VAR_ens_label from .env. Required; no default."
  type        = string
}

variable "vite_sepolia_rpc_url" {
  description = "VITE_SEPOLIA_RPC_URL baked into the Vite client at image BUILD_TIME. Set via TF_VAR_vite_sepolia_rpc_url from .env. Required; no default. Never commit secrets."
  type        = string
  sensitive   = true
}

variable "spaces_access_key_id" {
  description = "SPACES_ACCESS_KEY_ID for the app. Set via TF_VAR_spaces_access_key_id from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "spaces_secret" {
  description = "SPACES_SECRET for the app. Set via TF_VAR_spaces_secret from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "spaces_bucket" {
  description = "SPACES_BUCKET for the app. Set via TF_VAR_spaces_bucket from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "spaces_cdn_host" {
  description = "SPACES_CDN_HOST for the app. Set via TF_VAR_spaces_cdn_host from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "spaces_endpoint" {
  description = "SPACES_ENDPOINT for the app. Set via TF_VAR_spaces_endpoint from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "together_api_key" {
  description = "TOGETHER_API_KEY for the app. Set via TF_VAR_together_api_key from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "together_api_url" {
  description = "TOGETHER_API_URL for the app. Set via TF_VAR_together_api_url from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "together_image_model" {
  description = "TOGETHER_IMAGE_MODEL for the app. Set via TF_VAR_together_image_model from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "world_id_app_id" {
  description = "WORLD_ID_APP_ID for the app. Set via TF_VAR_world_id_app_id from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "world_id_rp_id" {
  description = "WORLD_ID_RP_ID for the app. Set via TF_VAR_world_id_rp_id from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "world_id_signing_key" {
  description = "WORLD_ID_SIGNING_KEY for the app. Set via TF_VAR_world_id_signing_key from .env. Required; no default. Never commit."
  type        = string
  sensitive   = true
}

variable "quorum_votes" {
  description = "QUORUM_VOTES game-loop timing (docs/game-loop.md). Required; no default."
  type        = number
}

variable "vote_countdown_seconds" {
  description = "VOTE_COUNTDOWN_SECONDS game-loop timing (docs/game-loop.md). Required; no default."
  type        = number
}

variable "bet_min_seconds" {
  description = "BET_MIN_SECONDS game-loop timing (docs/game-loop.md). Required; no default."
  type        = number
}

variable "video_timeout_seconds" {
  description = "VIDEO_TIMEOUT_SECONDS game-loop timing (docs/game-loop.md). Required; no default."
  type        = number
}

variable "settle_seconds" {
  description = "SETTLE_SECONDS game-loop timing (docs/game-loop.md). Required; no default."
  type        = number
}

variable "roster_ens_labels" {
  description = "ROSTER_ENS_LABELS comma-separated ENS labels for the shared roster (at least two). Required; no default."
  type        = string
}
