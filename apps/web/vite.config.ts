import { defineConfig, loadEnv } from "vite";

import { devProxy } from "./dev-proxy.ts";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, "../..", "");
  const gamePort = env.GAME_PORT?.trim() ?? "";
  const shared = {
    envDir: "../..",
    envPrefix: ["VITE_", "ENS_LABEL"],
    // WARNING: pre-bundling IDKit moves it away from its .wasm, and every waiver scan then ends at NOT ELIGIBLE.
    optimizeDeps: { exclude: ["@worldcoin/idkit-core"] },
  };
  const host = "127.0.0.1";
  if (gamePort === "") return { ...shared, server: { host } };
  return { ...shared, server: { host, proxy: devProxy(gamePort) } };
});
