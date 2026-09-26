# Horror Tube — DigitalOcean Terraform

Provisions Spaces buckets with CDN (character icons; fight videos/frames), a Managed PostgreSQL cluster (battle state) with a database firewall, and an App Platform service that serves the Vite client and the game Node process on one origin.

## Remote state (private Spaces bucket)

State is stored in a **private** DigitalOcean Spaces bucket via the Terraform `s3` backend (S3-compatible). That bucket is created once out-of-band — it cannot live in the same state it stores — and is not the icons bucket.

1. Copy `backend.hcl.example` to `backend.hcl` (gitignored). Set `bucket` to the state bucket name and keep `key` / `endpoint` as shown.
2. Take `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` from `TF_STATE_SPACES_ACCESS_KEY_ID` and `TF_STATE_SPACES_SECRET` in the repo-root `.env` (see `.env.example`). Unset `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, and `AWS_SESSION_TOKEN` before any terraform command. Do **not** use the icons-only `SPACES_ACCESS_KEY_ID` / `SPACES_SECRET` (`ethtokyo-spaces`) for state. Do not commit those credentials.
3. Init:

```bash
(
  set -euo pipefail
  root=$(git rev-parse --show-toplevel)
  set -a
  # shellcheck disable=SC1091
  source "$root/.env"
  set +a
  : "${TF_STATE_SPACES_ACCESS_KEY_ID:?TF_STATE_SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${TF_STATE_SPACES_SECRET:?TF_STATE_SPACES_SECRET is required. See .env.example.}"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN
  export AWS_ACCESS_KEY_ID="$TF_STATE_SPACES_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$TF_STATE_SPACES_SECRET"
  cd "$root/terraform"
  terraform init -backend-config=backend.hcl
)
```

`versions.tf` sets `region = "us-east-1"` inside the backend block. That string is the **AWS SDK dummy** Spaces requires for the S3 client; the bucket itself is in **sgp1**. It is not `var.region`, not `var.app_region`, and not where App Platform runs.

Skip flags (`skip_credentials_validation`, `skip_metadata_api_check`, `skip_region_validation`, `skip_requesting_account_id`, `skip_s3_checksum`) are required so Spaces accepts the state PUT (same checksum class of workaround as `request_checksum_calculation = when_required` for the AWS CLI profile above).

**State locking:** Spaces has no DynamoDB. Terraform’s S3 `use_lockfile` needs Terraform **>= 1.10**. This module allows `>= 1.5.0`; on 1.9.x there is **no** state lock. Do not invent a second lock service. Avoid concurrent applies.

`backend.hcl` and `*.tfstate` are gitignored. `terraform/.backend-credentials` is the old two-line file (access key id, then secret); agents should read `TF_STATE_SPACES_*` from `.env` instead. Never commit state or Spaces keys.

## Auth (token never on disk, never pasted into shell history)

Terraform’s DigitalOcean token is a **single** input: `var.do_token`, set only via `TF_VAR_do_token` (or the provider’s `DIGITALOCEAN_TOKEN` if you wire the provider that way). Do **not** put the token in `*.tfvars`, do **not** write it to a file in the repo, and do **not** `export` a pasted secret (that lands the secret in shell history).

Load the token from 1Password item **DigitalOcean IRC** into the process environment for that one command only:

```bash
cd terraform

env TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')" \
  terraform plan

env TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')" \
  terraform apply
```

The secret stays in the child process environment for that invocation; it is not written to disk and is not an `export` of a literal token.

### Spaces API keys (icon uploads)

Icon uploads authenticate with **`SPACES_ACCESS_KEY_ID`** and **`SPACES_SECRET`** in the repo `.env`. There are **no defaults** — if either is missing or blank, stop. Do not commit real values. `.env.example` lists only empty names, and the `# 1password:` comment above each name is the path to read once when `.env` is missing.

For `terraform plan` / `apply`, the DigitalOcean provider also reads `SPACES_ACCESS_KEY_ID` and `SPACES_SECRET_ACCESS_KEY` from the process environment to refresh buckets. For that one command, set those two from `TF_STATE_SPACES_*` (fullaccess). App Platform still gets the icons key via `TF_VAR_spaces_access_key_id` / `TF_VAR_spaces_secret` from `SPACES_ACCESS_KEY_ID` / `SPACES_SECRET` in `.env`.

The AWS CLI profile **`ethtokyo-spaces`** reads those two `.env` values through `scripts/spaces-credential-process`. That script does not call 1Password. In `~/.aws/config`:

```ini
[profile ethtokyo-spaces]
region = sgp1
endpoint_url = https://sgp1.digitaloceanspaces.com
request_checksum_calculation = when_required
response_checksum_validation = when_required
credential_process = /absolute/path/to/horror-tube/scripts/spaces-credential-process
```

`credential_process` is the absolute path of `scripts/spaces-credential-process` in this checkout. Shells in this repo set `AWS_PROFILE=ethtokyo-spaces`. A shell that still has `AWS_PROFILE=PowerUserAccess-598726163780` or `AWS_SESSION_TOKEN` sends the Together account instead of Spaces. Export `AWS_PROFILE=ethtokyo-spaces` and unset `AWS_SESSION_TOKEN` for the command.

If `.env` is missing, or either Spaces variable is blank, the script exits and names `.env.example`. Fill `.env` from those comments, then rerun. Do not call `op read` on every upload.

Key scope (confirmed via DigitalOcean API `GET /v2/spaces/keys`): key `ethtokyo-spaces` is limited to bucket `horror-tube-icons-sgp1-m4k9` with permission `readwrite` (UI: Read/Write/Delete). The CDN hostname is only a public read front for that same bucket; there is no separate CDN key. Sharing `spaces_access_key_id` and `spaces_secret` with the team shares that bucket only, not the DigitalOcean account and not the Postgres database.

```bash
(
  set -euo pipefail
  : "${KEY:?KEY (object key) is required}"
  AWS_PROFILE=ethtokyo-spaces aws s3 cp ./icon.png "s3://horror-tube-icons-sgp1-m4k9/${KEY}" \
    --acl public-read
)
```

`terraform apply` still loads the DigitalOcean API token from 1Password for that one command. Remote state and the provider Spaces env come from `TF_STATE_SPACES_*`; App Platform icons vars still come from `SPACES_*`:

```bash
(
  set -euo pipefail
  root=$(git rev-parse --show-toplevel)
  set -a
  # shellcheck disable=SC1091
  source "$root/.env"
  set +a
  : "${TF_STATE_SPACES_ACCESS_KEY_ID:?TF_STATE_SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${TF_STATE_SPACES_SECRET:?TF_STATE_SPACES_SECRET is required. See .env.example.}"
  : "${SPACES_ACCESS_KEY_ID:?SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${SPACES_SECRET:?SPACES_SECRET is required. See .env.example.}"
  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN
  export TF_VAR_spaces_access_key_id="$SPACES_ACCESS_KEY_ID"
  export TF_VAR_spaces_secret="$SPACES_SECRET"
  export AWS_ACCESS_KEY_ID="$TF_STATE_SPACES_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$TF_STATE_SPACES_SECRET"
  export SPACES_ACCESS_KEY_ID="$TF_STATE_SPACES_ACCESS_KEY_ID"
  export SPACES_SECRET_ACCESS_KEY="$TF_STATE_SPACES_SECRET"
  TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')"
  : "${TF_VAR_do_token:?TF_VAR_do_token is required}"
  export TF_VAR_do_token
  cd "$root/terraform"
  terraform apply
)
```

Every uploaded icon object must use ACL **`public-read`** so the CDN URL is publicly fetchable. Do not commit Spaces key values.

### Spaces API keys (fight-media uploads)

Fight video uploads use a **separate** bucket and a **bucket-scoped** Spaces key created by Terraform (`digitalocean_spaces_key.fight_media`, grant `readwrite` on the fight-media bucket only). Do not widen the icons key to the whole account.

After `terraform apply`, laptop `.env` is filled from 1Password item **Horror Tube fight media** (vault Private). The paths are in `.env.example`. Do not commit the secret.

| Terraform output | `.env` variable |
| --- | --- |
| `spaces_fight_media_access_key_id` | `FIGHT_MEDIA_SPACES_ACCESS_KEY_ID` |
| `spaces_fight_media_secret_key` | `FIGHT_MEDIA_SPACES_SECRET` |
| `spaces_fight_media_bucket_name` | `FIGHT_MEDIA_SPACES_BUCKET` |
| `spaces_fight_media_cdn_endpoint` | `FIGHT_MEDIA_SPACES_CDN_HOST` |

Also set `FIGHT_MEDIA_SPACES_ENDPOINT` to `https://<region>.digitaloceanspaces.com` for the same `region` tfvar (operator value `sgp1` → `https://sgp1.digitaloceanspaces.com`). If any of those variables is missing or blank, the upload package stops and names `.env.example`. Do not commit the secret.

Creating the fight-media bucket via Terraform still needs Spaces credentials on the provider that can create buckets (often a fullaccess Spaces key for that one apply). The icons-only key cannot create a second bucket. After apply, App Platform gets `FIGHT_MEDIA_SPACES_*` from the fight-media resources. Laptops read the same values from 1Password item **Horror Tube fight media**.

## Required tfvars (no defaults)

Copy `terraform.tfvars.example` to `terraform.tfvars` (gitignored) and set every value. There are **no** Terraform defaults for region, App Platform region, database size, bucket names, app name, GitHub repo, instance size, game port, or game-loop timings:

| Variable | Operator value for this project |
| --- | --- |
| `region` | `sgp1` (Singapore datacenter — Spaces + Managed Postgres; confirm via API before changing) |
| `app_region` | `sgp` (App Platform region slug from [list_regions](https://docs.digitalocean.com/reference/pydo/reference/apps/list_regions/); datacenter under it is `sgp1`. Do not pass `sgp1` here.) |
| `db_size` | `db-s-1vcpu-2gb` (from `GET /v2/databases/options`; do not substitute another size) |
| `spaces_bucket_name` | globally unique name |
| `spaces_fight_media_bucket_name` | globally unique name; not the icons bucket |
| `app_name` | `horror-tube` |
| `github_repo` | `etheroo-globaled-tokyo-2026/horror-tube` |
| `github_branch` | `main` (override with `-var='github_branch=…'` for a one-off deploy of another branch; do not commit a non-main value) |
| `instance_size_slug` | `apps-s-1vcpu-1gb` (from [App Platform pricing — Current Plans](https://docs.digitalocean.com/products/app-platform/details/pricing/); Node 22 + ffmpeg) |
| `game_port` | `8080` |
| `quorum_votes` / timings | see `docs/game-loop.md` (prod quorum 2, countdown 15, bet min 10, video timeout 300, settle 8) |

The Managed Postgres firewall keeps the hardcoded public IPv4 rules in `database.tf` (`0.0.0.0/1` and `128.0.0.0/1`) so hackathon laptops can reach Postgres, and adds a rule of type `app` whose value is the App Platform app id so the game service is a trusted source. DigitalOcean rejects literal `0.0.0.0/0`. It is not a tfvars setting.

There is no Tokyo DO region. Pick the geographically closest **datacenter** where **both** Spaces and Managed Postgres size `db-s-1vcpu-2gb` appear in the API (`/v2/regions` with storage, `/v2/databases/options` pg regions + layouts). That is normally `sgp1` for `var.region`. App Platform uses a separate shorter slug (`var.app_region` = `sgp` for Singapore).

`db-s-1vcpu-2gb` was verified under `options.pg.layouts` for `num_nodes: 1`.

## App Platform (game node + Vite)

`digitalocean_app.game` is one service built from the repo-root `Dockerfile`. Spec `region` is `var.app_region` (`sgp`), not `var.region` (`sgp1`). It listens on `game_port` (`GAME_PORT` / `http_port`), health-checks `GET /health`, and serves the Vite build from `STATIC_DIR` inside the image.

`ENS_LABEL` is build and runtime env (required, no default) so the Dockerfile can bake it into the Vite client and the server can name characters at settle. `VITE_SEPOLIA_RPC_URL` is build-time only. Without them the browser throws when `apps/web/game.ts` reads `import.meta.env`.

Push to `main` redeploys (`github.deploy_on_push = true`). The DigitalOcean team must already have the GitHub repository connected in the control panel, or apply fails when App Platform cannot clone the repo.

After apply, the public room URL is output `app_live_url` (health at `{app_live_url}/health`). This stack documents the resource; it does not claim apply has been run.

### DATABASE_URL (public URI, no VPC)

The app runtime `DATABASE_URL` is set in Terraform from `digitalocean_database_cluster.battle_state.uri` (the **public** connection URI). This stack does not create a VPC, so `private_uri` would not resolve from the App Platform container. Laptops still use output `database_uri` in `.env` for local tools. Do not pass `TF_VAR_database_url`.

### App runtime secrets (TF_VAR from `.env`, never in tfvars)

**Path:** 1Password is the human source of truth. The operator machine copies values into App Platform env at `terraform apply` via `TF_VAR_*` (sourced from the local `.env` for that one command). The App Platform instance does **not** read a `.env` (or any other secret file); DigitalOcean decrypts `type = "SECRET"` (and injects `GENERAL`) into `process.env` at runtime. DigitalOcean Secrets Manager (`doctl secrets`) is **not** the runtime path — there is no App Platform bind and no Terraform mount for those values.

Apply must pass the App Platform runtime env as Terraform variables (sensitive, no defaults, never committed), plus BUILD_TIME Vite env and fight narration/fal config. Source them from the repo `.env` for that one command:

| App env | Terraform variable | Notes |
| --- | --- | --- |
| `ENS_LABEL` | `TF_VAR_ens_label` | build and runtime; from `.env` |
| `VITE_SEPOLIA_RPC_URL` | `TF_VAR_vite_sepolia_rpc_url` | BUILD_TIME; from `.env` |
| `SEPOLIA_RPC_URL` | `TF_VAR_sepolia_rpc_url` | runtime ENS writes; from `.env` |
| `AGENT_PRIVATE_KEY` | `TF_VAR_agent_private_key` | runtime ENS status/injuries; from `.env`. Not `PRIVATE_KEY`. |
| `DATABASE_URL` | *(none)* | set from `battle_state.uri` in Terraform |
| `DATABASE_CA_CERT` | `TF_VAR_database_ca_cert` | from `.env` (DigitalOcean project CA PEM / API base64) |
| `SPACES_ACCESS_KEY_ID` | `TF_VAR_spaces_access_key_id` | from `.env` |
| `SPACES_SECRET` | `TF_VAR_spaces_secret` | from `.env` |
| `SPACES_BUCKET` | `TF_VAR_spaces_bucket` | from `.env` |
| `SPACES_CDN_HOST` | `TF_VAR_spaces_cdn_host` | from `.env` |
| `SPACES_ENDPOINT` | `TF_VAR_spaces_endpoint` | from `.env` |
| `TOGETHER_API_KEY` | `TF_VAR_together_api_key` | from `.env` |
| `TOGETHER_API_URL` | `TF_VAR_together_api_url` | from `.env` |
| `TOGETHER_IMAGE_MODEL` | `TF_VAR_together_image_model` | from `.env` |
| `WORLD_ID_APP_ID` | `TF_VAR_world_id_app_id` | from `.env` |
| `WORLD_ID_RP_ID` | `TF_VAR_world_id_rp_id` | from `.env` |
| `WORLD_ID_SIGNING_KEY` | `TF_VAR_world_id_signing_key` | from `.env` |
| `WORLD_ID_ENVIRONMENT` | `TF_VAR_world_id_environment` | from `.env` (operator: `production`) |
| `SHINAMI_ACCESS_KEY` | `TF_VAR_shinami_access_key` | from `.env` |
| `WALLET_SECRET_PEPPER` | `TF_VAR_wallet_secret_pepper` | from `.env`. Losing it loses every Invisible Wallet |
| `SUI_USDC_TYPE` | `TF_VAR_sui_usdc_type` | from `.env` |
| `FIGHT_MEDIA_SPACES_ACCESS_KEY_ID` | *(none)* | from `digitalocean_spaces_key.fight_media.access_key` |
| `FIGHT_MEDIA_SPACES_SECRET` | *(none)* | from `digitalocean_spaces_key.fight_media.secret_key` |
| `FIGHT_MEDIA_SPACES_BUCKET` | *(none)* | from `digitalocean_spaces_bucket.fight_media.name` |
| `FIGHT_MEDIA_SPACES_CDN_HOST` | *(none)* | from `digitalocean_cdn.fight_media.endpoint` |
| `FIGHT_MEDIA_SPACES_ENDPOINT` | *(none)* | `https://${var.region}.digitaloceanspaces.com` |
| `FAL_KEY` | `TF_VAR_fal_key` | from `.env` (SECRET) |
| `FAL_MODEL` | `TF_VAR_fal_model` | from `.env` |
| `FAL_IMAGE_TO_VIDEO_MODEL` | `TF_VAR_fal_image_to_video_model` | from `.env`; blank allowed until a prior frame exists |
| `FIGHT_VIDEO_SECONDS` | `TF_VAR_fight_video_seconds` | from `.env` |
| `FAL_VIDEO_RESOLUTION` | `TF_VAR_fal_video_resolution` | from `.env` |
| `FAL_PROMPT_EXPANSION_MODE` | `TF_VAR_fal_prompt_expansion_mode` | from `.env` |
| `FAL_ASPECT_RATIO` | `TF_VAR_fal_aspect_ratio` | from `.env` |
| `NARRATION_PROVIDER` | `TF_VAR_narration_provider` | from `.env` (`anthropic` or `gemini`) |
| `NARRATION_MODEL` | `TF_VAR_narration_model` | from `.env` |
| `ANTHROPIC_API_KEY` | `TF_VAR_anthropic_api_key` | from `.env` (SECRET); required when provider is `anthropic` |
| `GEMINI_API_KEY` | `TF_VAR_gemini_api_key` | from `.env` (SECRET); required when provider is `gemini` |

The game service gets the five `FIGHT_MEDIA_SPACES_*` env vars from the fight-media Spaces resources in the same apply (same pattern as `DATABASE_URL`). Do not pass `TF_VAR_fight_media_*`. Laptops read those five values from 1Password item **Horror Tube fight media** (`op://Private/Horror Tube fight media/...` in `.env.example`).

`@horror-tube/fight` (narration + fal video) is in the App Platform image. Those fight env vars are injected into `process.env` the same way as other App runtime secrets — not from a `.env` on the instance. Missing required values fail closed naming the variable. Both narration API key vars are present on the app; apply requires the key that matches `NARRATION_PROVIDER` and may pass an empty string for the unused one. One-shot deploy inputs (`PRIVATE_KEY`, `ROSTER_PRIVATE_KEY`, `PAYMENT_TOKEN`, `DURATION_SECONDS`, `OPERATOR_ADDRESS`, `TREASURY_ADDRESS`, `BET_FEE_BPS`, `MIN_BET_WEI`, `DASHBOARD_PORT`, `WORLD_ID_HTTP_PORT`) stay off the app spec — the container process does not read them. `BATTLE_BETTING_ADDRESS`, `SEPOLIA_RPC_URL`, and `AGENT_PRIVATE_KEY` are runtime env because the game opens battles and places bets, and settle writes ENS text.

Example apply that passes `.env` into `TF_VAR_*`, uses `TF_STATE_SPACES_*` for the backend and the provider Spaces env, and keeps icons `SPACES_*` on `TF_VAR_spaces_*`:

```bash
(
  set -euo pipefail
  root=$(git rev-parse --show-toplevel)
  set -a
  # shellcheck disable=SC1091
  source "$root/.env"
  set +a
  : "${ENS_LABEL:?ENS_LABEL is required. See .env.example.}"
  : "${VITE_SEPOLIA_RPC_URL:?VITE_SEPOLIA_RPC_URL is required. See .env.example.}"
  : "${SEPOLIA_RPC_URL:?SEPOLIA_RPC_URL is required. See .env.example.}"
  : "${AGENT_PRIVATE_KEY:?AGENT_PRIVATE_KEY is required. See .env.example.}"
  : "${TF_STATE_SPACES_ACCESS_KEY_ID:?TF_STATE_SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${TF_STATE_SPACES_SECRET:?TF_STATE_SPACES_SECRET is required. See .env.example.}"
  : "${SPACES_ACCESS_KEY_ID:?SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${SPACES_SECRET:?SPACES_SECRET is required. See .env.example.}"
  : "${SPACES_BUCKET:?SPACES_BUCKET is required. See .env.example.}"
  : "${SPACES_CDN_HOST:?SPACES_CDN_HOST is required. See .env.example.}"
  : "${SPACES_ENDPOINT:?SPACES_ENDPOINT is required. See .env.example.}"
  : "${TOGETHER_API_KEY:?TOGETHER_API_KEY is required. See .env.example.}"
  : "${TOGETHER_API_URL:?TOGETHER_API_URL is required. See .env.example.}"
  : "${TOGETHER_IMAGE_MODEL:?TOGETHER_IMAGE_MODEL is required. See .env.example.}"
  : "${WORLD_ID_APP_ID:?WORLD_ID_APP_ID is required. See .env.example.}"
  : "${WORLD_ID_RP_ID:?WORLD_ID_RP_ID is required. See .env.example.}"
  : "${WORLD_ID_SIGNING_KEY:?WORLD_ID_SIGNING_KEY is required. See .env.example.}"
  : "${WORLD_ID_ENVIRONMENT:?WORLD_ID_ENVIRONMENT is required. See .env.example.}"
  : "${DATABASE_CA_CERT:?DATABASE_CA_CERT is required. See .env.example.}"
  : "${SHINAMI_ACCESS_KEY:?SHINAMI_ACCESS_KEY is required. See .env.example.}"
  : "${WALLET_SECRET_PEPPER:?WALLET_SECRET_PEPPER is required. See .env.example.}"
  : "${SUI_USDC_TYPE:?SUI_USDC_TYPE is required. See .env.example.}"
  : "${FAL_KEY:?FAL_KEY is required. See .env.example.}"
  : "${FAL_MODEL:?FAL_MODEL is required. See .env.example.}"
  : "${FIGHT_VIDEO_SECONDS:?FIGHT_VIDEO_SECONDS is required. See .env.example.}"
  : "${FAL_VIDEO_RESOLUTION:?FAL_VIDEO_RESOLUTION is required. See .env.example.}"
  : "${FAL_PROMPT_EXPANSION_MODE:?FAL_PROMPT_EXPANSION_MODE is required. See .env.example.}"
  : "${FAL_ASPECT_RATIO:?FAL_ASPECT_RATIO is required. See .env.example.}"
  : "${NARRATION_PROVIDER:?NARRATION_PROVIDER is required. See .env.example.}"
  : "${NARRATION_MODEL:?NARRATION_MODEL is required. See .env.example.}"
  case "$NARRATION_PROVIDER" in
    anthropic)
      : "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required when NARRATION_PROVIDER=anthropic. See .env.example.}"
      ;;
    gemini)
      : "${GEMINI_API_KEY:?GEMINI_API_KEY is required when NARRATION_PROVIDER=gemini. See .env.example.}"
      ;;
    *)
      echo "NARRATION_PROVIDER must be anthropic or gemini. Got: ${NARRATION_PROVIDER}. See .env.example." >&2
      exit 1
      ;;
  esac
  unset AWS_PROFILE AWS_DEFAULT_PROFILE AWS_SESSION_TOKEN
  TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')"
  export TF_VAR_do_token
  export TF_VAR_ens_label="$ENS_LABEL"
  export TF_VAR_vite_sepolia_rpc_url="$VITE_SEPOLIA_RPC_URL"
  export TF_VAR_sepolia_rpc_url="$SEPOLIA_RPC_URL"
  export TF_VAR_agent_private_key="$AGENT_PRIVATE_KEY"
  export TF_VAR_database_ca_cert="$DATABASE_CA_CERT"
  export TF_VAR_spaces_access_key_id="$SPACES_ACCESS_KEY_ID"
  export TF_VAR_spaces_secret="$SPACES_SECRET"
  export TF_VAR_spaces_bucket="$SPACES_BUCKET"
  export TF_VAR_spaces_cdn_host="$SPACES_CDN_HOST"
  export TF_VAR_spaces_endpoint="$SPACES_ENDPOINT"
  export TF_VAR_together_api_key="$TOGETHER_API_KEY"
  export TF_VAR_together_api_url="$TOGETHER_API_URL"
  export TF_VAR_together_image_model="$TOGETHER_IMAGE_MODEL"
  export TF_VAR_world_id_app_id="$WORLD_ID_APP_ID"
  export TF_VAR_world_id_rp_id="$WORLD_ID_RP_ID"
  export TF_VAR_world_id_signing_key="$WORLD_ID_SIGNING_KEY"
  export TF_VAR_world_id_environment="$WORLD_ID_ENVIRONMENT"
  export TF_VAR_shinami_access_key="$SHINAMI_ACCESS_KEY"
  export TF_VAR_wallet_secret_pepper="$WALLET_SECRET_PEPPER"
  export TF_VAR_sui_usdc_type="$SUI_USDC_TYPE"
  export TF_VAR_fal_key="$FAL_KEY"
  export TF_VAR_fal_model="$FAL_MODEL"
  export TF_VAR_fal_image_to_video_model="${FAL_IMAGE_TO_VIDEO_MODEL-}"
  export TF_VAR_fight_video_seconds="$FIGHT_VIDEO_SECONDS"
  export TF_VAR_fal_video_resolution="$FAL_VIDEO_RESOLUTION"
  export TF_VAR_fal_prompt_expansion_mode="$FAL_PROMPT_EXPANSION_MODE"
  export TF_VAR_fal_aspect_ratio="$FAL_ASPECT_RATIO"
  export TF_VAR_narration_provider="$NARRATION_PROVIDER"
  export TF_VAR_narration_model="$NARRATION_MODEL"
  export TF_VAR_anthropic_api_key="${ANTHROPIC_API_KEY-}"
  export TF_VAR_gemini_api_key="${GEMINI_API_KEY-}"
  export AWS_ACCESS_KEY_ID="$TF_STATE_SPACES_ACCESS_KEY_ID"
  export AWS_SECRET_ACCESS_KEY="$TF_STATE_SPACES_SECRET"
  export SPACES_ACCESS_KEY_ID="$TF_STATE_SPACES_ACCESS_KEY_ID"
  export SPACES_SECRET_ACCESS_KEY="$TF_STATE_SPACES_SECRET"
  cd "$root/terraform"
  terraform apply
)
```

Do not put those secret values in `terraform.tfvars` or `terraform.tfvars.example`.

## Spaces icons: public read + CDN

The bucket is created with `acl = public-read` and a CDN is attached (`spaces_cdn_endpoint` output). Uploads still must set each object’s ACL to **`public-read`** (see the Spaces API keys section above). Public icon URLs use `https://` + CDN endpoint + object key. Applied bucket: `horror-tube-icons-sgp1-m4k9` (CDN: `horror-tube-icons-sgp1-m4k9.sgp1.cdn.digitaloceanspaces.com`, region `sgp1`).

## Spaces fight media: public read + CDN

The fight-media bucket is created the same way (`acl = public-read`, CDN at `spaces_fight_media_cdn_endpoint`). Video object keys live under `videos/` and last-frame JPEGs under `frames/` (a new key per upload; never overwrite). Public URLs use `https://` + CDN endpoint + object key. Uploads must set object ACL **`public-read`**.

## Validate

```bash
cd terraform
terraform init
terraform validate
```
