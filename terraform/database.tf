# Managed PostgreSQL for battle state (issue #6).
# Size slug default comes from GET https://api.digitalocean.com/v2/databases/options
# (options.pg.layouts with num_nodes=1 includes "db-s-1vcpu-2gb").

resource "digitalocean_database_cluster" "battle_state" {
  name       = var.db_name
  engine     = "pg"
  version    = var.db_engine_version
  size       = var.db_size
  region     = var.region
  node_count = 1
}
