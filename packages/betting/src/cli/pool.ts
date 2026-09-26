import { createClient, readBettingConfig } from "../env.js";
import { poolId } from "../ids.js";
import { getPool } from "../objects.js";

const battleId = process.argv[2];
if (battleId === undefined || battleId.trim() === "") {
  console.error("Usage: pnpm betting:pool <battleId>");
  process.exit(1);
}

const config = readBettingConfig();
const id = poolId(config, battleId);
const pool = await getPool(createClient(config), id);
if (pool === null) console.log(`No pool for battle ${battleId} (${id}).`);
else
  console.log(
    JSON.stringify(
      {
        id: pool.id,
        houseId: pool.houseId,
        battleId: pool.battleId,
        status: pool.status,
        closesAtMs: pool.closesAtMs.toString(),
        feeBps: pool.feeBps.toString(),
        winningSide: pool.winningSide.toString(),
        fee: pool.fee.toString(),
        totals: pool.totals.map(String),
        pot: pool.pot.toString(),
      },
      null,
      2,
    ),
  );
