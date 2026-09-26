import { readBettingConfig, readKeypair, readKeypairs, requiredEnv } from "@horror-tube/betting";
import { loadFalVideoConfig, loadNarrationConfig, loadPairingConfig } from "@horror-tube/fight";
import { readFightMediaConfig } from "@horror-tube/fight-media";
import { loadWorldIdEnv } from "@horror-tube/world-id";
import { readDatabaseCaCert } from "./db/database-ca.js";
import { readDatabaseUrl } from "./db/database-url.js";
import { readEnsWriteEnv } from "./ens-chain-write.js";
import { readGamePort, readStaticDir } from "./env.js";
import { readGameLoopConfig, readRosterEnsLabels } from "./game/config.js";
import { readHouseBotStakeUnits } from "./house-bot-chain.js";
import { createWalletHandlerFromEnv } from "./wallet-handler.js";

const READERS: Array<(env: NodeJS.ProcessEnv) => void> = [
  loadWorldIdEnv,
  readGamePort,
  readStaticDir,
  readDatabaseUrl,
  readDatabaseCaCert,
  readBettingConfig,
  (env) => readKeypair("SUI_OPERATOR_PRIVATE_KEY", env),
  (env) => requiredEnv("SUI_OPERATOR_CAP_ID", env),
  (env) => readKeypairs("HOUSE_BOT_SUI_PRIVATE_KEYS", env),
  readHouseBotStakeUnits,
  (env) => createWalletHandlerFromEnv(env, () => {}),
  readGameLoopConfig,
  readRosterEnsLabels,
  readEnsWriteEnv,
  loadPairingConfig,
  loadNarrationConfig,
  loadFalVideoConfig,
  readFightMediaConfig,
];

export function envProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems = new Set<string>();
  for (const read of READERS) {
    try {
      read(env);
    } catch (cause) {
      problems.add(cause instanceof Error ? cause.message : String(cause));
    }
  }
  return [...problems];
}

export function assertEnvComplete(env: NodeJS.ProcessEnv = process.env): void {
  const problems = envProblems(env);
  if (problems.length === 0) return;
  throw new Error(
    `.env is not ready for the game server (${String(problems.length)} problem(s)):\n${problems.map((p) => `  - ${p}`).join("\n")}`,
  );
}
