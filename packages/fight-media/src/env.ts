export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example. Refusing to fall back.`,
    );
  }
  return value.trim();
}

export type FightMediaConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  cdnHost: string;
  endpoint: string;
  region: string;
};

export function spacesRegionFromEndpoint(endpoint: string): string {
  let host: string;
  try {
    host = new URL(endpoint).hostname;
  } catch (cause) {
    throw new Error(
      `FIGHT_MEDIA_SPACES_ENDPOINT must be an absolute URL with a host. Got: ${JSON.stringify(endpoint)}`,
      { cause },
    );
  }
  const region = host.split(".", 1)[0]?.trim() ?? "";
  if (region === "") {
    throw new Error(
      `FIGHT_MEDIA_SPACES_ENDPOINT host has no Spaces region prefix. Got: ${JSON.stringify(host)}`,
    );
  }
  return region;
}

export function readFightMediaConfig(env: NodeJS.ProcessEnv = process.env): FightMediaConfig {
  const accessKeyId = requiredEnv("FIGHT_MEDIA_SPACES_ACCESS_KEY_ID", env);
  const secretAccessKey = requiredEnv("FIGHT_MEDIA_SPACES_SECRET", env);
  const bucket = requiredEnv("FIGHT_MEDIA_SPACES_BUCKET", env);
  const cdnHost = requiredEnv("FIGHT_MEDIA_SPACES_CDN_HOST", env);
  const endpoint = requiredEnv("FIGHT_MEDIA_SPACES_ENDPOINT", env);
  return {
    accessKeyId,
    secretAccessKey,
    bucket,
    cdnHost,
    endpoint,
    region: spacesRegionFromEndpoint(endpoint),
  };
}
