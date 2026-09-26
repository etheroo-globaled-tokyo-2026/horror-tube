function singleSegmentId(kind: "video" | "frame", id: string): string {
  const trimmed = id.trim();
  if (trimmed === "") {
    throw new Error(`${kind} object id is blank. Refusing to build a Spaces key.`);
  }
  if (trimmed.includes("/") || trimmed.includes("..")) {
    throw new Error(
      `${kind} object id must be a single path segment. Got: ${JSON.stringify(id)}`,
    );
  }
  return trimmed;
}

/** Object key under videos/ for one fight mp4. */
export function videoObjectKey(id: string): string {
  return `videos/${singleSegmentId("video", id)}.mp4`;
}

/** Object key under frames/ for one last-frame jpeg (next-fight seed). */
export function frameObjectKey(id: string): string {
  return `frames/${singleSegmentId("frame", id)}.jpg`;
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
      "FIGHT_MEDIA_SPACES_CDN_HOST is blank after normalization. Refusing to build a CDN URL.",
    );
  }
  const key = objectKey.trim().replace(/^\/+/u, "");
  if (key === "") {
    throw new Error("object key is blank. Refusing to build a CDN URL.");
  }
  return `https://${host}/${key}`;
}
