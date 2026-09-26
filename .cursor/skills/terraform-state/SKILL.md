---
name: terraform-state
description: >-
  Authenticate Terraform against the DigitalOcean Spaces remote-state bucket
  for this repo. Use when running terraform init, plan, or apply; when remote
  state fails; when reading or writing .backend-credentials; or when setting
  AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY for Horror Tube Terraform.
---

# Terraform remote-state Spaces key

The icons key (`SPACES_ACCESS_KEY_ID` / `SPACES_SECRET`) cannot read or write the state bucket. Use the fullaccess state key named in `.env` as `TF_STATE_SPACES_*`.

## Before any terraform command

1. Read `DO_KEY` from the repo-root `.env` and export it as `TF_VAR_do_token`. Do not call `op read`. If it is missing or blank, stop and name `DO_KEY`.
2. Read `TF_STATE_SPACES_ACCESS_KEY_ID` and `TF_STATE_SPACES_SECRET` from the repo-root `.env` (see `.env.example`).
3. If either is missing or blank, stop and name the variable. Do not substitute the icons key or invent a value.
4. Unset `AWS_PROFILE`, `AWS_DEFAULT_PROFILE`, and `AWS_SESSION_TOKEN`.
5. Export the two values as `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.
6. For `plan` / `apply` only, also export them as `SPACES_ACCESS_KEY_ID` and `SPACES_SECRET_ACCESS_KEY` for that process. The DigitalOcean provider uses those names to refresh buckets.
7. Keep `TF_VAR_spaces_access_key_id` and `TF_VAR_spaces_secret` sourced from the icons `SPACES_ACCESS_KEY_ID` and `SPACES_SECRET` already in `.env` (App Platform runtime / icon uploads). Do not overwrite those `TF_VAR_*` values with the state key.
8. Do not commit `.env`, `.backend-credentials`, or `backend.hcl`.
9. Do not print the key values.

## Notes

- Spaces key name: `horror-tube-tfstate` (fullaccess). State bucket: `horror-tube-tfstate-sgp1-k7p2`.
- `terraform/.backend-credentials` is the old two-line file (access key id, then secret). Source of truth for agents is `TF_STATE_SPACES_*` in `.env`.
- DigitalOcean API token is `DO_KEY` in the repo-root `.env`. Pass it as `TF_VAR_do_token` for the terraform process and as the bearer token for DigitalOcean API calls. Do not call `op read`. If `DO_KEY` is missing or blank, stop and name `DO_KEY`.
