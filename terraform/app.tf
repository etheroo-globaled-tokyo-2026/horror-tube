# App Platform service: one Node process serves the Vite build and the API
# (issue #54). App region is var.app_region (operator: sgp — App Platform slug;
# Spaces/Postgres use var.region sgp1). Push to main redeploys via github.deploy_on_push.

resource "digitalocean_app" "game" {
  spec {
    name   = var.app_name
    region = var.app_region

    service {
      name               = "game"
      instance_count     = 1
      instance_size_slug = var.instance_size_slug
      http_port          = var.game_port
      dockerfile_path    = "Dockerfile"

      github {
        repo           = var.github_repo
        branch         = var.github_branch
        deploy_on_push = true
      }

      health_check {
        http_path = "/health"
      }

      # Baked into the Vite client at image build (apps/web/game.ts via import.meta.env).
      env {
        key   = "ENS_LABEL"
        value = var.ens_label
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "VITE_SEPOLIA_RPC_URL"
        value = var.vite_sepolia_rpc_url
        scope = "BUILD_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "GAME_PORT"
        value = tostring(var.game_port)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      # Public URI: this app has no VPC, so private_uri would not resolve.
      env {
        key   = "DATABASE_URL"
        value = digitalocean_database_cluster.battle_state.uri
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "DATABASE_CA_CERT"
        value = var.database_ca_cert
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "SPACES_ACCESS_KEY_ID"
        value = var.spaces_access_key_id
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "SPACES_SECRET"
        value = var.spaces_secret
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "SPACES_BUCKET"
        value = var.spaces_bucket
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "SPACES_CDN_HOST"
        value = var.spaces_cdn_host
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "SPACES_ENDPOINT"
        value = var.spaces_endpoint
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "TOGETHER_API_KEY"
        value = var.together_api_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "TOGETHER_API_URL"
        value = var.together_api_url
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "TOGETHER_IMAGE_MODEL"
        value = var.together_image_model
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "WORLD_ID_APP_ID"
        value = var.world_id_app_id
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "WORLD_ID_RP_ID"
        value = var.world_id_rp_id
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "WORLD_ID_SIGNING_KEY"
        value = var.world_id_signing_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "SHINAMI_ACCESS_KEY"
        value = var.shinami_access_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "WALLET_SECRET_PEPPER"
        value = var.wallet_secret_pepper
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "WORLD_ID_ENVIRONMENT"
        value = var.world_id_environment
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "SUI_USDC_TYPE"
        value = var.sui_usdc_type
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "QUORUM_VOTES"
        value = tostring(var.quorum_votes)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "VOTE_COUNTDOWN_SECONDS"
        value = tostring(var.vote_countdown_seconds)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "BET_MIN_SECONDS"
        value = tostring(var.bet_min_seconds)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "VIDEO_TIMEOUT_SECONDS"
        value = tostring(var.video_timeout_seconds)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "SETTLE_SECONDS"
        value = tostring(var.settle_seconds)
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "ROSTER_ENS_LABELS"
        value = var.roster_ens_labels
        scope = "RUN_TIME"
        type  = "GENERAL"
      }
    }
  }
}
