export type WorldIdEnvironment = "production" | "staging";

export type WorldIdEnv = {
  appId: string;
  rpId: string;
  signingKeyHex: string;
  environment: WorldIdEnvironment;
};

export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(`${name} is required. Set it in .env. See .env.example.`);
  }
  return value.trim();
}

export function loadWorldIdEnv(env: NodeJS.ProcessEnv = process.env): WorldIdEnv {
  const appId = requireEnv("WORLD_ID_APP_ID", env.WORLD_ID_APP_ID);
  if (!appId.startsWith("app_")) {
    throw new Error(
      "WORLD_ID_APP_ID must be the Developer Portal app_id (app_...). See .env.example.",
    );
  }
  const rpId = requireEnv("WORLD_ID_RP_ID", env.WORLD_ID_RP_ID);
  if (!rpId.startsWith("rp_")) {
    throw new Error(
      "WORLD_ID_RP_ID must be the Developer Portal rp_id (rp_...). See .env.example.",
    );
  }
  const signingKeyHex = requireEnv("WORLD_ID_SIGNING_KEY", env.WORLD_ID_SIGNING_KEY);
  if (!/^(0x)?[0-9a-fA-F]{64}$/u.test(signingKeyHex)) {
    throw new Error(
      "WORLD_ID_SIGNING_KEY must be a 32-byte hex key from the Developer Portal. See .env.example.",
    );
  }
  const environment = requireEnv("WORLD_ID_ENVIRONMENT", env.WORLD_ID_ENVIRONMENT);
  if (environment !== "production" && environment !== "staging") {
    throw new Error(
      `WORLD_ID_ENVIRONMENT must be production or staging. Got ${environment}. See .env.example.`,
    );
  }
  return { appId, rpId, signingKeyHex, environment };
}
