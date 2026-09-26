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

      # Baked into the Vite client at image build, and present at runtime so
      # settle can build character names (<label>.<ENS_LABEL>.eth).
      env {
        key   = "ENS_LABEL"
        value = var.ens_label
        scope = "RUN_AND_BUILD_TIME"
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
        key   = "WORLD_ID_PRACTICE_ACTIONS"
        value = var.world_id_practice_actions
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "WORLD_ID_JUDGE_ACTION"
        value = var.world_id_judge_action
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
        key   = "FIGHT_MEDIA_SPACES_ACCESS_KEY_ID"
        value = digitalocean_spaces_key.fight_media.access_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "FIGHT_MEDIA_SPACES_SECRET"
        value = digitalocean_spaces_key.fight_media.secret_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "FIGHT_MEDIA_SPACES_BUCKET"
        value = digitalocean_spaces_bucket.fight_media.name
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "FIGHT_MEDIA_SPACES_CDN_HOST"
        value = digitalocean_cdn.fight_media.endpoint
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "FIGHT_MEDIA_SPACES_ENDPOINT"
        value = "https://${var.region}.digitaloceanspaces.com"
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
        key   = "SKIP_BATTLE_SETTLEMENT"
        value = var.skip_battle_settlement
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "WORLD_ID_PROOF"
        value = var.world_id_proof
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "ROSTER_ENS_LABELS"
        value = var.roster_ens_labels
        scope = "RUN_TIME"
        type  = "GENERAL"
      }

      env {
        key   = "SEPOLIA_RPC_URL"
        value = var.sepolia_rpc_url
        scope = "RUN_TIME"
        type  = "SECRET"
      }

      env {
        key   = "AGENT_PRIVATE_KEY"
        value = var.agent_private_key
        scope = "RUN_TIME"
        type  = "SECRET"
      }
    }
  }
}
