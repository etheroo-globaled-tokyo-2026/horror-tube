/** Object key under videos/ for one fight mp4. */
export function videoObjectKey(id: string): string {
  const trimmed = id.trim();
  if (trimmed === "") {
    throw new Error("video object id is blank. Refusing to build a Spaces key.");
  }
  if (trimmed.includes("/") || trimmed.includes("..")) {
    throw new Error(
      `video object id must be a single path segment. Got: ${JSON.stringify(id)}`,
    );
  }
  return `videos/${trimmed}.mp4`;
}

export function fightMediaCdnUrl(cdnHost: string, objectKey: string): string {
  let host = cdnHost.trim();
  if (host.startsWith("https://")) {
    host = host.slice("https://".length);
  } else if (host.startsWith("http://")) {
    throw new Error(
      `FIGHT_MEDIA_SPACES_CDN_HOST must be a hostname (optionally with https://). Got http:// URL: ${JSON.stringify(cdnHost)}`,
    );
  }
  host = host.trim().replace(/\/+$/u, "");
  if (host === "") {
    throw new Error(
      "FIGHT_MEDIA_SPACES_CDN_HOST is blank after normalization. Refusing to build a video URL.",
    );
  }
  const key = objectKey.trim().replace(/^\/+/u, "");
  if (key === "") {
    throw new Error("video object key is blank. Refusing to build a video URL.");
  }
  return `https://${host}/${key}`;
}
