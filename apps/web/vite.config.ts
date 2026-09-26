import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // envDir is the repo root so GAME_PORT matches the Node server.
  const env = loadEnv(mode, "../..", "");
  const gamePort = env.GAME_PORT?.trim() ?? "";
  const proxy =
    gamePort === ""
      ? undefined
      : {
          "/events": `http://127.0.0.1:${gamePort}`,
          "/round": `http://127.0.0.1:${gamePort}`,
          "/vote": `http://127.0.0.1:${gamePort}`,
          "/bet": `http://127.0.0.1:${gamePort}`,
          "/health": `http://127.0.0.1:${gamePort}`,
        };

  return {
    envDir: "../..",
    envPrefix: ["VITE_", "ENS_LABEL"],
    server: proxy === undefined ? undefined : { proxy },
  };
});
