import { API_PATHS } from "../server/src/routes.ts";

export const gameServerUrlPattern = `^(${API_PATHS.join("|")})(\\?.*)?$`;

export function devProxy(gamePort: string) {
  return {
    [gameServerUrlPattern]: {
      target: `http://127.0.0.1:${gamePort}`,
      changeOrigin: true,
    },
  };
}
