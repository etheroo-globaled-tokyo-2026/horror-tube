import { createEnv } from "@t3-oss/env-core";
import * as v from "valibot";

export const readWebEnv = () =>
  createEnv({
    shared: {
      ENS_LABEL: v.optional(
        v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/, "must be one lowercase label, not a full name")),
        "horrortube",
      ),
    },
    clientPrefix: "VITE_",
    client: {
      VITE_SEPOLIA_RPC_URL: v.optional(
        v.pipe(v.string(), v.url()),
        "https://ethereum-sepolia-rpc.publicnode.com",
      ),
    },
    runtimeEnv: import.meta.env,
    emptyStringAsUndefined: true,
    onValidationError: (issues) => {
      const lines = issues.map(
        (i) =>
          `${(i.path ?? []).map((p) => String(p instanceof Object ? p.key : p)).join(".")} ${i.message}`,
      );
      throw new Error(`Invalid env in the repo-root .env: ${lines.join("; ")}. See .env.example.`);
    },
  });
