import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { cryptoRandomInt } from "@horror-tube/fight/rotation";
import { createClient, getPool, requiredEnv } from "@horror-tube/betting";
import { loadWorldIdEnv } from "@horror-tube/world-id";
import { createBattleBettingPorts, readHouseFeeBps } from "./battle-betting.js";
import { assertDatabaseReady } from "./db/assert-database-ready.js";
import { migrate } from "./db/migrate.js";
import { PostgresBattleQueueStore } from "./db/battle-results.js";
import { PostgresRoundStore } from "./db/rounds.js";
import { PostgresPoolLedger } from "./db/sui-pools.js";
import { createPgPool } from "./db/pg-client.js";
import { createEnsChainWritePorts, readRosterEnsStatuses } from "./ens-chain-write.js";
import { loadRepoDotenv, readGamePort, readStaticDir } from "./env.js";
import { createFightJobRunner } from "./fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "./game/config.js";
import { GameLoop } from "./game/loop.js";
import { loadLivingCardsFromEns } from "./load-living-cards.js";
import { createGameServer, listenGameServer } from "./server.js";
import {
  recordPools,
  releaseLivePool,
  sweepStrandedPools,
  type PoolChain,
} from "./stranded-pools.js";
import { createWalletHandlerFromEnv } from "./wallet-handler.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(join(repoRoot, ".env"));

loadWorldIdEnv();

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";
const suiPoolTimeoutMs = 20_000;
const suiOperator = createBattleBettingPorts();
const fightJob = createFightJobRunner({
  loadLivingCards: (subnames) => loadLivingCardsFromEns(subnames),
});

await assertDatabaseReady();
console.log("database: verified TLS connection ok");
const migrations = await migrate();
console.log(
  `database: migrations applied [${migrations.applied.join(", ")}], ${String(migrations.skipped.length)} already applied`,
);

const pg = createPgPool();
const battleQueueStore = new PostgresBattleQueueStore(pg);
const poolLedger = new PostgresPoolLedger(pg);
const battleBetting = recordPools(suiOperator, poolLedger);
const chainWritePorts = createEnsChainWritePorts(process.env, {
  settle: (battleId, side) => battleBetting.settle(battleId, side),
});

const ensLabels = readRosterEnsLabels();
const ensStatuses = await readRosterEnsStatuses(ensLabels);
const game = new GameLoop({
  config: readGameLoopConfig(),
  ensLabels,
  ensStatuses,
  randomInt: cryptoRandomInt,
  battleQueueStore,
  roundStore: new PostgresRoundStore(pg),
  chainWritePorts,
  battleBetting,
  fightJob,
});

const wallet = createWalletHandlerFromEnv(process.env, (poolId) => game.assertBetAllowed(poolId));
const sessionPepper = requiredEnv("WALLET_SECRET_PEPPER");
const feeBps = await readHouseFeeBps(battleBetting.config);
console.log(`betting: house ${battleBetting.config.houseId} fee_bps=${String(feeBps)}`);

const suiClient = createClient(battleBetting.config);
const suiPools: PoolChain = {
  readPool: (poolId) => getPool(suiClient, poolId),
  cancel: (battleId) => suiOperator.cancelBattle(battleId),
};
await sweepStrandedPools(suiPools, poolLedger, suiPoolTimeoutMs);

const bettingPublic = {
  packageId: battleBetting.config.packageId,
  houseId: battleBetting.config.houseId,
  coinType: battleBetting.config.coinType,
  network: battleBetting.config.network,
  feeBps,
};

const server = createGameServer({
  port,
  host,
  staticDir,
  wallet,
  game,
  sessionPepper,
  betting: bettingPublic,
});
await listenGameServer(server, {
  port,
  host,
  staticDir,
  wallet,
  game,
  sessionPepper,
  betting: bettingPublic,
});

const tickMs = 250;
let tickBusy = false;
const tickTimer = setInterval(() => {
  if (tickBusy) {
    return;
  }
  tickBusy = true;
  void game
    .tick()
    .catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`game tick failed: ${message}`);
    })
    .finally(() => {
      tickBusy = false;
    });
}, tickMs);

let stopping = false;
function shutDown(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;
  clearInterval(tickTimer);
  console.log(`${signal}: game loop stopped; releasing the live Sui pool before exit.`);
  releaseLivePool(game.getState(), suiPools, poolLedger, suiPoolTimeoutMs).then(
    () => process.exit(0),
    (cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`Shutdown: ${message}. The next startup sweep retries it.`);
      process.exit(1);
    },
  );
}
process.once("SIGTERM", shutDown);
process.once("SIGINT", shutDown);

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`) +
    ` · game loop quorum=${String(game.config.quorumVotes)} roster=${String(game.ensLabels.length)}`,
);
