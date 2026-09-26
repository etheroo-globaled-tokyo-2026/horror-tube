import { defineConfig, loadEnv } from "vite";

const devProxy = (gamePort: string) => ({
  "^/(auth/world-id|tx|wallet|world-id/request|world-id/verify|events|round|betting|health|playback-start)(\\?.*)?$":
    {
      target: `http://127.0.0.1:${gamePort}`,
      changeOrigin: true,
    },
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const gamePort = env.GAME_PORT?.trim() ?? "";
  const shared = {
    envDir: "../..",
    envPrefix: ["VITE_", "ENS_LABEL"],
    // WARNING: pre-bundling IDKit moves it away from its .wasm, and every waiver scan then ends at NOT ELIGIBLE.
    optimizeDeps: { exclude: ["@worldcoin/idkit-core"] },
  };
  if (gamePort === "") return shared;
  return { ...shared, server: { proxy: devProxy(gamePort) } };
});
