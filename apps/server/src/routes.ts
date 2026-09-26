export const API_PATHS = [
  "/health",
  "/round",
  "/events",
  "/playback-start",
  "/vote",
  "/betting",
  "/retry-settle",
  "/auth/world-id",
  "/wallet",
  "/tx",
  "/world-id/request",
  "/world-id/verify",
] as const;

export type ApiPath = (typeof API_PATHS)[number];

const apiPaths = new Set<string>(API_PATHS);

export function isApiPath(path: string): path is ApiPath {
  return apiPaths.has(path);
}
