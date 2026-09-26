import { requiredEnv } from "@horror-tube/betting";

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return requiredEnv("DATABASE_URL", env);
}
