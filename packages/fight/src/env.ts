export class FightError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FightError";
  }
}

export function requiredEnv(
  name: string,
  env: Record<string, string | undefined>,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new FightError(
      `${name} is required. Set it in .env. See .env.example.`,
    );
  }
  return value.trim();
}

export type NarrationProvider = "anthropic" | "gemini";

export type NarrationConfig = {
  provider: NarrationProvider;
  model: string;
  fightVideoSeconds: number;
  apiKey: string;
};

export type FalVideoConfig = {
  apiKey: string;
  model: string;
  durationSeconds: number;
  resolution: string;
  promptExpansionMode: string;
  aspectRatio: string;
};

function parsePositiveInt(name: string, raw: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new FightError(
      `${name} must be a positive integer. Got: ${JSON.stringify(raw)}`,
    );
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new FightError(
      `${name} must be a positive integer. Got: ${JSON.stringify(raw)}`,
    );
  }
  return n;
}

export function loadNarrationConfig(
  env: Record<string, string | undefined>,
): NarrationConfig {
  const providerRaw = requiredEnv("NARRATION_PROVIDER", env);
  if (providerRaw !== "anthropic" && providerRaw !== "gemini") {
    throw new FightError(
      `NARRATION_PROVIDER must be "anthropic" or "gemini". Got: ${JSON.stringify(providerRaw)}. Refusing to fall back to another provider.`,
    );
  }
  const model = requiredEnv("NARRATION_MODEL", env);
  const fightVideoSeconds = parsePositiveInt(
    "FIGHT_VIDEO_SECONDS",
    requiredEnv("FIGHT_VIDEO_SECONDS", env),
  );
  const apiKey =
    providerRaw === "anthropic"
      ? requiredEnv("ANTHROPIC_API_KEY", env)
      : requiredEnv("GEMINI_API_KEY", env);
  return {
    provider: providerRaw,
    model,
    fightVideoSeconds,
    apiKey,
  };
}

export function loadFalVideoConfig(
  env: Record<string, string | undefined>,
): FalVideoConfig {
  return {
    apiKey: requiredEnv("FAL_KEY", env),
    model: requiredEnv("FAL_MODEL", env),
    durationSeconds: parsePositiveInt(
      "FIGHT_VIDEO_SECONDS",
      requiredEnv("FIGHT_VIDEO_SECONDS", env),
    ),
    resolution: requiredEnv("FAL_VIDEO_RESOLUTION", env),
    promptExpansionMode: requiredEnv("FAL_PROMPT_EXPANSION_MODE", env),
    aspectRatio: requiredEnv("FAL_ASPECT_RATIO", env),
  };
}
