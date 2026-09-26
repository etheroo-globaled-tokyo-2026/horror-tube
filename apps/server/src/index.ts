import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { cryptoRandomInt } from "@horror-tube/fight/rotation";
import { loadWorldIdEnv } from "@horror-tube/world-id";
import { createBattleBettingPorts } from "./battle-betting.js";
import { assertDatabaseReady } from "./db/assert-database-ready.js";
import { PostgresBattleQueueStore } from "./db/battle-results.js";
import { PostgresRoundStore } from "./db/rounds.js";
import { createPgPool } from "./db/pg-client.js";
import { createEnsChainWritePorts, readRosterEnsStatuses } from "./ens-chain-write.js";
import {
  loadRepoDotenv,
  readGamePort,
  readSkipBattleSettlement,
  readStaticDir,
  requiredEnv,
} from "./env.js";
import { createFightJobRunner } from "./fight-job.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "./game/config.js";
import { GameLoop } from "./game/loop.js";
import { loadLivingCardsFromEns } from "./load-living-cards.js";
import { createGameServer, listenGameServer } from "./server.js";
import { createWalletHandlerFromEnv } from "./wallet-handler.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(join(repoRoot, ".env"));

// Fail closed before listen: the waiver gate needs a signed World ID request.
loadWorldIdEnv();

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";
const skipSettlement = readSkipBattleSettlement();
const battleBetting = createBattleBettingPorts();
const fightJob = createFightJobRunner({
  loadLivingCards: (subnames) => loadLivingCardsFromEns(subnames),
});

await assertDatabaseReady();
console.log("database: verified TLS connection ok");

const pg = createPgPool();
const battleQueueStore = new PostgresBattleQueueStore(pg);
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
  skipSettlement,
});

const wallet = createWalletHandlerFromEnv(process.env, (poolId) => game.assertBetAllowed(poolId));
const sessionPepper = requiredEnv("WALLET_SECRET_PEPPER");
const feeBpsRaw = requiredEnv("BET_FEE_BPS");
if (!/^[0-9]+$/u.test(feeBpsRaw)) {
  throw new Error(
    `BET_FEE_BPS must be a whole number. Got ${JSON.stringify(feeBpsRaw)}.`,
  );
}

const bettingPublic = {
  packageId: battleBetting.config.packageId,
  houseId: battleBetting.config.houseId,
  coinType: battleBetting.config.coinType,
  network: battleBetting.config.network,
  feeBps: Number(feeBpsRaw),
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
setInterval(() => {
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

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`) +
    ` · game loop quorum=${String(game.config.quorumVotes)} roster=${String(game.ensLabels.length)}` +
    ` skipSettlement=${String(skipSettlement)}`,
);
