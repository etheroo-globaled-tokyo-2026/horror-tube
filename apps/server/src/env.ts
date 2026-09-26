import { requiredEnv } from "@horror-tube/betting";
import { config as loadDotenv } from "dotenv";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function loadRepoDotenv(repoRoot: string): string[] {
  const loaded = [".env.local", ".env"].filter((name) => existsSync(join(repoRoot, name)));
  if (loaded.length === 0) return loaded;
  const result = loadDotenv({ path: loaded.map((name) => join(repoRoot, name)), quiet: true });
  if (result.error !== undefined) {
    throw result.error;
  }
  return loaded;
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

export function readStaticDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
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
