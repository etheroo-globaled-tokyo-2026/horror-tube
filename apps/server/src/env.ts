import { existsSync, statSync } from "node:fs";

export function requiredEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example.`,
    );
  }
  return value;
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
