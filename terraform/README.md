# Horror Tube — DigitalOcean Terraform

Provisions a Spaces bucket with CDN (character icons) and a Managed PostgreSQL cluster (battle state) with a database firewall.

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

## Required tfvars (no defaults)

Copy `terraform.tfvars.example` to `terraform.tfvars` (gitignored) and set every value. There are **no** Terraform defaults for region, database size, or bucket name:

| Variable | Operator value for this project |
| --- | --- |
| `region` | `sgp1` (Singapore — closest DigitalOcean region to Tokyo with Spaces + Managed Postgres; confirm via API before changing) |
| `db_size` | `db-s-1vcpu-2gb` (from `GET /v2/databases/options`; do not substitute another size) |
| `spaces_bucket_name` | globally unique name |

The Managed Postgres firewall is hardcoded public in `database.tf` (`0.0.0.0/1` and `128.0.0.0/1`, covering all IPv4) because hackathon developers are not on one IP. DigitalOcean rejects literal `0.0.0.0/0`. It is not a tfvars setting.

There is no Tokyo DO region. Pick the geographically closest region where **both** Spaces and Managed Postgres size `db-s-1vcpu-2gb` appear in the API (`/v2/regions` with storage, `/v2/databases/options` pg regions + layouts). That is normally `sgp1`.

`db-s-1vcpu-2gb` was verified under `options.pg.layouts` for `num_nodes: 1`.

## Spaces icons: public read + CDN

The bucket is created with `acl = public-read` and a CDN is attached (`spaces_cdn_endpoint` output). Uploads still must set each object’s ACL to **`public-read`** (see the Spaces API keys section above). Public icon URLs use `https://` + CDN endpoint + object key. Applied bucket: `horror-tube-icons-sgp1-m4k9` (CDN: `horror-tube-icons-sgp1-m4k9.sgp1.cdn.digitaloceanspaces.com`, region `sgp1`).

## Validate

```bash
cd terraform
terraform init
terraform validate
```
