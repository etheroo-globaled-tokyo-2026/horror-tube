#!/usr/bin/env bash
# Local Postgres for `pnpm dev`, so a laptop never points the game server at the production database.
# postgres:16 in Docker on 127.0.0.1 with ssl=on and a throwaway CA (the server only accepts verified TLS).
# Run before `pnpm dev`; put the two lines it prints on stdout in .env.local.
# Usage: scripts/local-db.sh [--reset]   (reuses the container; --reset recreates it and drops its data)
set -euo pipefail

container=horror-tube-local-pg
image=postgres:16
port="${LOCAL_DB_PORT:-55432}"
user=horror
password=horror
db=horror
certs="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.local-db"

log() { printf 'local-db: %s\n' "$*" >&2; }
fail() {
  log "FAILED: $*"
  exit 1
}
quiet() {
  local out
  if ! out="$("$@" 2>&1)"; then
    printf '%s\n' "$out" >&2
    fail "$*"
  fi
}

reset=false
case "${1:-}" in
  "") ;;
  --reset) reset=true ;;
  *) fail "unknown argument '$1'. Usage: scripts/local-db.sh [--reset]" ;;
esac

command -v docker >/dev/null || fail "docker is not on PATH"
command -v openssl >/dev/null || fail "openssl is not on PATH"
docker info >/dev/null 2>&1 || fail "the Docker daemon is not running"

ensure_certs() {
  if [ -f "$certs/ca.crt" ] && [ -f "$certs/server.key" ] && [ -f "$certs/server.crt" ] &&
    openssl x509 -checkend 86400 -noout -in "$certs/server.crt" >/dev/null 2>&1; then
    log "reusing the CA and server cert in $certs"
    return
  fi
  log "creating a throwaway CA and a server cert for localhost and 127.0.0.1 in $certs"
  mkdir -p "$certs"
  quiet openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=horror-tube-local-ca" \
    -keyout "$certs/ca.key" -out "$certs/ca.crt"
  quiet openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" \
    -keyout "$certs/server.key" -out "$certs/server.csr"
  printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n' \
    >"$certs/server.ext"
  quiet openssl x509 -req -days 365 -in "$certs/server.csr" -CA "$certs/ca.crt" -CAkey "$certs/ca.key" \
    -CAcreateserial -extfile "$certs/server.ext" -out "$certs/server.crt"
  chmod 600 "$certs/ca.key" "$certs/server.key"
}

state="$(docker ps -a --filter "name=^${container}$" --format '{{.State}}')"
if $reset && [ -n "$state" ]; then
  log "--reset: removing $container and its data"
  quiet docker rm -f -v "$container"
  state=""
fi

case "$state" in
  running) log "reusing running container $container" ;;
  exited | created)
    log "starting stopped container $container"
    quiet docker start "$container"
    ;;
  "")
    ensure_certs
    log "starting $image as $container on 127.0.0.1:$port (pulls the image on first run)"
    # The key must be owned by the postgres user with mode 600, which a macOS bind mount cannot give it.
    quiet docker run -d --name "$container" \
      -e POSTGRES_USER="$user" -e POSTGRES_PASSWORD="$password" -e POSTGRES_DB="$db" \
      -p "127.0.0.1:$port:5432" -v "$certs:/certs:ro" --entrypoint bash "$image" -c '
        set -e
        install -d -o postgres -g postgres -m 700 /ssl
        install -o postgres -g postgres -m 600 /certs/server.key /ssl/server.key
        install -o postgres -g postgres -m 644 /certs/server.crt /ssl/server.crt
        exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/ssl/server.crt -c ssl_key_file=/ssl/server.key'
    ;;
  *) fail "$container is $state. Run scripts/local-db.sh --reset to recreate it." ;;
esac

log "waiting for pg_isready over TCP (up to 60s)"
for i in $(seq 1 60); do
  if docker exec "$container" pg_isready -h 127.0.0.1 -U "$user" -d "$db" >/dev/null 2>&1; then
    break
  fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$container")" != "true" ] || [ "$i" -eq 60 ]; then
    docker logs "$container" >&2
    fail "Postgres in $container did not become ready. Its log is above. --reset recreates it."
  fi
  sleep 1
done

log "checking a verify-full TLS login with the CA"
quiet docker exec -e PGPASSWORD="$password" "$container" \
  psql "sslmode=verify-full sslrootcert=/certs/ca.crt host=localhost user=$user dbname=$db" -tAc 'select 1'

mapping="$(docker port "$container" 5432/tcp | head -n 1)"
[ -n "$mapping" ] || fail "$container does not publish port 5432"
port="${mapping##*:}"
ca_dir="$(docker inspect -f '{{range .Mounts}}{{if eq .Destination "/certs"}}{{.Source}}{{end}}{{end}}' "$container")"
ca="$(docker exec "$container" cat /certs/ca.crt)" || fail "could not read /certs/ca.crt from $container"

log "ready on 127.0.0.1:$port. CA file: $ca_dir/ca.crt"
log "put these two lines in .env.local:"
printf 'DATABASE_URL=postgres://%s:%s@127.0.0.1:%s/%s\n' "$user" "$password" "$port" "$db"
printf 'DATABASE_CA_CERT=%s\n' "$(printf '%s\n' "$ca" | base64 | tr -d '\n')"
