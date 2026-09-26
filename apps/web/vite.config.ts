import { defineConfig, loadEnv } from "vite";

const devProxy = (gamePort: string) => ({
  "/auth": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/tx": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/wallet": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/world-id": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/events": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/round": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/vote": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/bet": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
  "/health": { target: `http://127.0.0.1:${gamePort}`, changeOrigin: true },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const gamePort = env.GAME_PORT?.trim() ?? "";
  const shared = {
    envDir: "../..",
    envPrefix: ["VITE_", "ENS_LABEL"],
  };
  if (gamePort === "") return shared;
  return { ...shared, server: { proxy: devProxy(gamePort) } };
});
