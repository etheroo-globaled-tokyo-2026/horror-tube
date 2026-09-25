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

Icon uploads authenticate with **`SPACES_ACCESS_KEY_ID`** and **`SPACES_SECRET`** from the environment. There are **no defaults** — if either is missing or blank, stop. Do not put real values in `.env` committed to git; `.env.example` lists only empty names.

Store and load them from 1Password item **ETHTokyo DigitalOcean** (vault Private), fields `spaces_access_key_id` and `spaces_secret` (key name `ethtokyo-spaces`). Pass them for one command only (never as literals in an `export`):

```bash
env SPACES_ACCESS_KEY_ID="$(op read 'op://Private/ETHTokyo DigitalOcean/spaces_access_key_id')" \
  SPACES_SECRET="$(op read 'op://Private/ETHTokyo DigitalOcean/spaces_secret')" \
  aws s3 cp ./icon.png "s3://${BUCKET}/${KEY}" \
  --endpoint-url "https://${REGION}.digitaloceanspaces.com" \
  --acl public-read
```

Every uploaded icon object must use ACL **`public-read`** so the CDN URL is publicly fetchable. Do not commit Spaces key values.

## Required tfvars (no defaults)

Copy `terraform.tfvars.example` to `terraform.tfvars` (gitignored) and set every value. There are **no** Terraform defaults for region, database size, bucket name, or database firewall CIDR:

| Variable | Operator value for this project |
| --- | --- |
| `region` | `sgp1` (Singapore — closest DigitalOcean region to Tokyo with Spaces + Managed Postgres; confirm via API before changing) |
| `db_size` | `db-s-1vcpu-2gb` (from `GET /v2/databases/options`; do not substitute another size) |
| `spaces_bucket_name` | globally unique name |
| `db_firewall_cidr` | your public IP as `x.x.x.x/32` — never `0.0.0.0/0` |

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
