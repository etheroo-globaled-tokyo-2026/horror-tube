# Horror Tube — DigitalOcean Terraform

Provisions Spaces buckets with CDN (character icons; fight videos/frames), a Managed PostgreSQL cluster (battle state) with a database firewall, and an App Platform service that serves the Vite client and the game Node process on one origin.

## Remote state (private Spaces bucket)

State is stored in a **private** DigitalOcean Spaces bucket via the Terraform `s3` backend (S3-compatible). That bucket is created once out-of-band — it cannot live in the same state it stores — and is not the icons bucket.

1. Copy `backend.hcl.example` to `backend.hcl` (gitignored). Set `bucket` to the state bucket name and keep `key` / `endpoint` as shown.
2. Put Spaces credentials that can read/write that bucket in the process environment as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` for `terraform init` / plan / apply. Do **not** use the icons-only `ethtokyo-spaces` key. Do not commit those credentials.
3. Init:

```bash
cd terraform
terraform init -backend-config=backend.hcl
```

`versions.tf` sets `region = "us-east-1"` inside the backend block. That string is the **AWS SDK dummy** Spaces requires for the S3 client; the bucket itself is in **sgp1**. It is not `var.region`, not `var.app_region`, and not where App Platform runs.

Skip flags (`skip_credentials_validation`, `skip_metadata_api_check`, `skip_region_validation`, `skip_requesting_account_id`, `skip_s3_checksum`) are required so Spaces accepts the state PUT (same checksum class of workaround as `request_checksum_calculation = when_required` for the AWS CLI profile above).

**State locking:** Spaces has no DynamoDB. Terraform’s S3 `use_lockfile` needs Terraform **>= 1.10**. This module allows `>= 1.5.0`; on 1.9.x there is **no** state lock. Do not invent a second lock service. Avoid concurrent applies.

`backend.hcl`, `*.tfstate`, and `.backend-credentials` are gitignored. Never commit state or Spaces keys.

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

`terraform apply` still expects the DigitalOcean provider env name **`SPACES_SECRET_ACCESS_KEY`**. App uploads use **`SPACES_SECRET`**. Copy `SPACES_SECRET` from `.env` into `SPACES_SECRET_ACCESS_KEY` for that command.

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

`terraform apply` still loads the DigitalOcean API token from 1Password for that one command. Spaces keys come from `.env`:

```bash
(
  set -euo pipefail
  root=$(git rev-parse --show-toplevel)
  set -a
  # shellcheck disable=SC1091
  source "$root/.env"
  set +a
  : "${SPACES_ACCESS_KEY_ID:?SPACES_ACCESS_KEY_ID is required. See .env.example.}"
  : "${SPACES_SECRET:?SPACES_SECRET is required. See .env.example.}"
  TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')"
  : "${TF_VAR_do_token:?TF_VAR_do_token is required}"
  export TF_VAR_do_token SPACES_ACCESS_KEY_ID
  export SPACES_SECRET_ACCESS_KEY="$SPACES_SECRET"
  terraform apply
)
```

Every uploaded icon object must use ACL **`public-read`** so the CDN URL is publicly fetchable. Do not commit Spaces key values.

### Spaces API keys (fight-media uploads)

Fight video uploads use a **separate** bucket and a **bucket-scoped** Spaces key created by Terraform (`digitalocean_spaces_key.fight_media`, grant `readwrite` on the fight-media bucket only). Do not widen the icons key to the whole account.

After `terraform apply`, copy the sensitive outputs into `.env` (and into 1Password when you create the item). There is no 1Password path yet for these values — `.env.example` says so:

| Terraform output | `.env` variable |
| --- | --- |
| `spaces_fight_media_access_key_id` | `FIGHT_MEDIA_SPACES_ACCESS_KEY_ID` |
| `spaces_fight_media_secret_key` | `FIGHT_MEDIA_SPACES_SECRET` |
| `spaces_fight_media_bucket_name` | `FIGHT_MEDIA_SPACES_BUCKET` |
| `spaces_fight_media_cdn_endpoint` | `FIGHT_MEDIA_SPACES_CDN_HOST` |

Also set `FIGHT_MEDIA_SPACES_ENDPOINT` to `https://<region>.digitaloceanspaces.com` for the same `region` tfvar (operator value `sgp1` → `https://sgp1.digitaloceanspaces.com`). If any of those variables is missing or blank, the upload package stops and names `.env.example`. Do not commit the secret.

Creating the fight-media bucket via Terraform still needs Spaces credentials on the provider that can create buckets (often a fullaccess Spaces key for that one apply). The icons-only key cannot create a second bucket. After apply, app uploads use only `FIGHT_MEDIA_SPACES_*`.

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

`ENS_LABEL` and `VITE_SEPOLIA_RPC_URL` are `BUILD_TIME` env on the service (required Terraform variables, no defaults) so the Dockerfile can bake them into the Vite client. Without them the browser throws when `apps/web/game.ts` reads `import.meta.env`.

Push to `main` redeploys (`github.deploy_on_push = true`). The DigitalOcean team must already have the GitHub repository connected in the control panel, or apply fails when App Platform cannot clone the repo.

After apply, the public room URL is output `app_live_url` (health at `{app_live_url}/health`). This stack documents the resource; it does not claim apply has been run.

### DATABASE_URL (public URI, no VPC)

The app runtime `DATABASE_URL` is set in Terraform from `digitalocean_database_cluster.battle_state.uri` (the **public** connection URI). This stack does not create a VPC, so `private_uri` would not resolve from the App Platform container. Laptops still use output `database_uri` in `.env` for local tools. Do not pass `TF_VAR_database_url`.

### App runtime secrets (TF_VAR from `.env`, never in tfvars)

Apply must pass the App Platform runtime env as Terraform variables (sensitive, no defaults, never committed), plus BUILD_TIME Vite env. Source them from the repo `.env` for that one command:

| App env | Terraform variable | Notes |
| --- | --- | --- |
| `ENS_LABEL` | `TF_VAR_ens_label` | BUILD_TIME; from `.env` |
| `VITE_SEPOLIA_RPC_URL` | `TF_VAR_vite_sepolia_rpc_url` | BUILD_TIME; from `.env` |
| `DATABASE_URL` | *(none)* | set from `battle_state.uri` in Terraform |
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

`FAL_KEY` / `FAL_MODEL` stay in `.env.example` for local video work; they are not wired into App Platform here (nothing in this service reads them yet).

Example apply that wires `.env` into `TF_VAR_*` (plus the Spaces provider key rename):

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
  : "${SHINAMI_ACCESS_KEY:?SHINAMI_ACCESS_KEY is required. See .env.example.}"
  : "${WALLET_SECRET_PEPPER:?WALLET_SECRET_PEPPER is required. See .env.example.}"
  : "${SUI_USDC_TYPE:?SUI_USDC_TYPE is required. See .env.example.}"
  TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')"
  export TF_VAR_do_token
  export TF_VAR_ens_label="$ENS_LABEL"
  export TF_VAR_vite_sepolia_rpc_url="$VITE_SEPOLIA_RPC_URL"
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
  export SPACES_ACCESS_KEY_ID
  export SPACES_SECRET_ACCESS_KEY="$SPACES_SECRET"
  cd "$root/terraform"
  terraform apply
)
```

Do not put those secret values in `terraform.tfvars` or `terraform.tfvars.example`.

## Spaces icons: public read + CDN

The bucket is created with `acl = public-read` and a CDN is attached (`spaces_cdn_endpoint` output). Uploads still must set each object’s ACL to **`public-read`** (see the Spaces API keys section above). Public icon URLs use `https://` + CDN endpoint + object key. Applied bucket: `horror-tube-icons-sgp1-m4k9` (CDN: `horror-tube-icons-sgp1-m4k9.sgp1.cdn.digitaloceanspaces.com`, region `sgp1`).

## Spaces fight media: public read + CDN

The fight-media bucket is created the same way (`acl = public-read`, CDN at `spaces_fight_media_cdn_endpoint`). Video object keys live under `videos/` (a new key per upload; never overwrite). Issue #53 will use `frames/` in this same bucket. Public URLs use `https://` + CDN endpoint + object key. Uploads must set object ACL **`public-read`**.

## Validate

```bash
cd terraform
terraform init
terraform validate
```
