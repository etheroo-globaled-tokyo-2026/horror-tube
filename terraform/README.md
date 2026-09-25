# Horror Tube — DigitalOcean Terraform

Provisions a Spaces bucket with CDN (character icons) and a Managed PostgreSQL cluster (battle state). This PR only adds the code; **do not run `terraform apply` from CI or as part of merging it.**

## Auth (token never on disk)

Terraform expects `var.do_token`. Export it at apply/plan time from 1Password into the process environment:

```bash
export DIGITALOCEAN_TOKEN="$(op item get 'DigitalOcean IRC' --fields api_key --reveal)"
export TF_VAR_do_token="$DIGITALOCEAN_TOKEN"
```

`TF_VAR_do_token` feeds the Terraform variable. `DIGITALOCEAN_TOKEN` is the provider’s native env name — keep them equal when you apply. Do not write the token into `*.tfvars` or commit it.

Spaces API calls also need access keys at apply time (create in the DigitalOcean control panel):

```bash
export SPACES_ACCESS_KEY_ID="..."
export SPACES_SECRET_ACCESS_KEY="..."
```

## Database size

Default `db_size` is **`db-s-1vcpu-2gb`**.

Verified with `GET https://api.digitalocean.com/v2/databases/options`: under `options.pg.layouts` for `num_nodes: 1`, the `sizes` list includes `db-s-*` plans. The slug encodes **1 vCPU** and **2 GB RAM**. That skips the smallest `db-s-1vcpu-1gb` plan for a snappier hackathon demo without jumping to multi-vCPU production sizes (`db-s-2vcpu-4gb` and up).

Region default is **`nyc3`** so Spaces and Postgres share a Spaces-capable region from the same options list.

## Validate only

```bash
cd terraform
terraform init -backend=false
terraform validate
```

Set `TF_VAR_spaces_bucket_name` (or pass `-var`) to a unique bucket name before plan/apply. Apply is intentionally out of scope for this change.
