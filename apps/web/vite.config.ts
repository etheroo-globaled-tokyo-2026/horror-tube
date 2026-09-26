import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const gamePort = env.GAME_PORT?.trim();
  const proxy =
    gamePort === undefined || gamePort === ""
      ? undefined
      : {
          "/world-id": {
            target: `http://127.0.0.1:${gamePort}`,
            changeOrigin: true,
          },
        };

  return {
    envDir: "../..",
    envPrefix: ["VITE_", "ENS_LABEL"],
    ...(proxy === undefined ? {} : { server: { proxy } }),
  };
});
