import { requiredEnv } from "@horror-tube/betting";
import { config as loadDotenv } from "dotenv";
import { existsSync, statSync } from "node:fs";

/**
 * Load a `.env` file only when it exists (laptop checkout).
 * App Platform has no `.env` on disk; the process uses injected env only.
 * A missing file is not an error. Missing required variables still fail by name.
 */
export function loadRepoDotenv(envPath: string): { loaded: boolean } {
  if (!existsSync(envPath)) {
    return { loaded: false };
  }
  const result = loadDotenv({ path: envPath });
  if (result.error !== undefined) {
    throw result.error;
  }
  return { loaded: true };
}

export function readGamePort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = requiredEnv("GAME_PORT", env);
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `GAME_PORT must be an integer 1..65535. Got: ${JSON.stringify(raw)}. See .env.example.`,
    );
  }
  return port;
}

/**
 * When STATIC_DIR is unset, the process serves only /health (local Vite serves the UI).
 * When set, it must be an existing directory.
 */
export function readStaticDir(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const raw = env.STATIC_DIR;
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const dir = raw.trim();
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(
      `STATIC_DIR is set to ${JSON.stringify(dir)} but that path is not an existing directory.`,
    );
  }
  return dir;
}

export function readRosterRefreshMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = requiredEnv("ENS_ROSTER_REFRESH_MS", env).trim();
  if (!/^[0-9]+$/u.test(raw)) {
    throw new Error(
      `ENS_ROSTER_REFRESH_MS must be a positive integer (milliseconds). Got ${JSON.stringify(raw)}. See .env.example.`,
    );
  }
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms) || ms < 1) {
    throw new Error(
      `ENS_ROSTER_REFRESH_MS must be a positive integer (milliseconds). Got ${JSON.stringify(raw)}. See .env.example.`,
    );
  }
  return ms;
}

export function readSkipBattleSettlement(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.SKIP_BATTLE_SETTLEMENT;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "SKIP_BATTLE_SETTLEMENT is required. Set it in .env. See .env.example.",
    );
  }
  const value = raw.trim();
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  throw new Error(
    `SKIP_BATTLE_SETTLEMENT must be "0" or "1". Got: ${JSON.stringify(raw)}. Set it in .env. See .env.example.`,
  );
}
