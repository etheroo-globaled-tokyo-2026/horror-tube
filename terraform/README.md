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

### Spaces API keys (apply time)

Spaces also needs access keys (control panel or `POST /v2/spaces/keys` with a `fullaccess` grant — a key with empty `grants` gets AccessDenied). Pass them for that command only the same way (from 1Password or another secret store — never as literals in an `export`):

```bash
env TF_VAR_do_token="$(op read 'op://Personal/DigitalOcean IRC/api_key')" \
  SPACES_ACCESS_KEY_ID="$(op read 'op://…/spaces_access_key')" \
  SPACES_SECRET_ACCESS_KEY="$(op read 'op://…/spaces_secret_key')" \
  terraform apply
```

Replace the Spaces `op://` paths with your items. Do not commit those values.

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

The bucket is created with `acl = public-read` and a CDN is attached (`spaces_cdn_endpoint` output). If a later upload path only sets public-read per object, upload icons with an object ACL of `public-read`, for example:

```bash
aws s3 cp ./icon.png "s3://${BUCKET}/${KEY}" \
  --endpoint-url "https://${REGION}.digitaloceanspaces.com" \
  --acl public-read
```

Pass Spaces credentials via the same one-shot `env` pattern as above. Public icon URLs use `https://` + CDN endpoint + object key.

## Validate

```bash
cd terraform
terraform init
terraform validate
```
