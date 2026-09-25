# Managed PostgreSQL for battle state (issue #6).
# Size slug must be set explicitly (operator: db-s-1vcpu-2gb from
# GET https://api.digitalocean.com/v2/databases/options).

resource "digitalocean_database_cluster" "battle_state" {
  name       = var.db_name
  engine     = "pg"
  version    = var.db_engine_version
  size       = var.db_size
  region     = var.region
  node_count = 1
}

resource "digitalocean_database_firewall" "battle_state" {
  cluster_id = digitalocean_database_cluster.battle_state.id

  rule {
    type  = "ip_addr"
    value = var.db_firewall_cidr
  }
}
