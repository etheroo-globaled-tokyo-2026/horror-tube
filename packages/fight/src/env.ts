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
  /** Text-to-video model id (first fight in a chain). From FAL_MODEL. */
  model: string;
  /**
   * Image-to-video model id for fights that reuse a prior last frame.
   * Null when FAL_IMAGE_TO_VIDEO_MODEL is missing/blank. Required when a prior
   * frame URL is present — resolveFalSubscribeModel fails closed rather than
   * dropping the frame and calling text-to-video.
   */
  imageToVideoModel: string | null;
  durationSeconds: number;
  resolution: string;
  promptExpansionMode: string;
  aspectRatio: string;
};

/**
 * Pick the fal endpoint for this bout. With a prior frame URL, require the
 * image-to-video model from env. Without one, use text-to-video.
 */
export function resolveFalSubscribeModel(
  config: FalVideoConfig,
  priorFrameUrl: string | undefined,
): string {
  const prior =
    priorFrameUrl === undefined ? undefined : priorFrameUrl.trim();
  if (prior !== undefined && prior === "") {
    throw new FightError(
      "priorFrameUrl is blank. Pass a CDN frame URL or omit it for text-to-video. Refusing to call fal.",
    );
  }
  if (prior !== undefined) {
    if (config.imageToVideoModel === null) {
      throw new FightError(
        "FAL_IMAGE_TO_VIDEO_MODEL is required when a prior fight frame URL is set. Set it in .env. See .env.example. Refusing to drop the frame and call text-to-video.",
      );
    }
    return config.imageToVideoModel;
  }
  return config.model;
}

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

/** A switch that must be set to exactly "0" or "1", so a typo can't quietly turn a step off. */
function requiredSwitch(
  name: string,
  env: Record<string, string | undefined>,
): boolean {
  const value = requiredEnv(name, env);
  if (value === "1") {
    return true;
  }
  if (value === "0") {
    return false;
  }
  throw new FightError(
    `${name} must be "0" or "1". Got: ${JSON.stringify(env[name])}. Set it in .env. See .env.example.`,
  );
}

export type RotoscopeConfig = {
  /** Base URL of `rotoscope serve`, without a trailing slash. */
  url: string;
  /** How long one rotoscope request may take, from ROTOSCOPE_TIMEOUT_MS. */
  timeoutMs: number;
};

/** What happens to fal's video before upload. */
export type VideoEffectsConfig = {
  /** DEMON_SOUND=1: the sound goes through FAITH's possessed-demon voice chain. */
  demonSound: boolean;
  /** ROTOSCOPE=1: the rotoscope service redraws the video. Null when ROTOSCOPE=0. */
  rotoscope: RotoscopeConfig | null;
};

export function loadVideoEffectsConfig(
  env: Record<string, string | undefined>,
): VideoEffectsConfig {
  const demonSound = requiredSwitch("DEMON_SOUND", env);
  if (!requiredSwitch("ROTOSCOPE", env)) {
    return { demonSound, rotoscope: null };
  }
  const url = requiredEnv("ROTOSCOPE_URL", env);
  if (!URL.canParse(url) || !/^https?:$/u.test(new URL(url).protocol)) {
    throw new FightError(
      `ROTOSCOPE_URL must be an http or https URL. Got: ${JSON.stringify(url)}. Set it in .env. See .env.example.`,
    );
  }
  return {
    demonSound,
    rotoscope: {
      url: url.replace(/\/+$/u, ""),
      timeoutMs: parsePositiveInt(
        "ROTOSCOPE_TIMEOUT_MS",
        requiredEnv("ROTOSCOPE_TIMEOUT_MS", env),
      ),
    },
  };
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
  const imageRaw = env.FAL_IMAGE_TO_VIDEO_MODEL;
  const imageToVideoModel =
    imageRaw === undefined || imageRaw.trim() === ""
      ? null
      : imageRaw.trim();
  return {
    apiKey: requiredEnv("FAL_KEY", env),
    model: requiredEnv("FAL_MODEL", env),
    imageToVideoModel,
    durationSeconds: parsePositiveInt(
      "FIGHT_VIDEO_SECONDS",
      requiredEnv("FIGHT_VIDEO_SECONDS", env),
    ),
    resolution: requiredEnv("FAL_VIDEO_RESOLUTION", env),
    promptExpansionMode: requiredEnv("FAL_PROMPT_EXPANSION_MODE", env),
    aspectRatio: requiredEnv("FAL_ASPECT_RATIO", env),
  };
}
