export function requireEnv(name: string, value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example. Refusing to invent a value.`,
    );
  }
  return value.trim();
}

export type WorldIdEnv = {
  rpId: string;
  signingKeyHex: string;
};

export function loadWorldIdEnv(env: NodeJS.ProcessEnv = process.env): WorldIdEnv {
  return {
    rpId: requireEnv("WORLD_ID_RP_ID", env.WORLD_ID_RP_ID),
    signingKeyHex: requireEnv("WORLD_ID_SIGNING_KEY", env.WORLD_ID_SIGNING_KEY),
  };
}
