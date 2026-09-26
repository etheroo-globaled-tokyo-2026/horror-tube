import type { IncomingMessage, ServerResponse } from "node:http";

import { normalizeStructTag, normalizeSuiAddress } from "@mysten/sui/utils";
import type { VerifyFetch } from "@horror-tube/world-id";
import * as v from "valibot";

import { requiredEnv } from "@horror-tube/betting";
import { HttpError } from "./http-error.js";
import { issueSession, readSession, walletSecret } from "./human-session.js";
import { sendJson } from "./server.js";
import {
  gaslessError,
  isWalletAlreadyExists,
  shinamiPort,
  type ShinamiPort,
} from "./shinami-port.js";
import { assertSponsorableKind, betPoolIds } from "./tx-policy.js";
import { verifyEnterRoomProof } from "./world-id-handler.js";

const BODY_LIMIT = 1_000_000;

const ROUTES = new Set(["/auth/world-id", "/wallet", "/tx"]);

const TxBody = v.object({
  txKind: v.pipe(v.string(), v.minLength(1)),
});

export type WalletHandlerDeps = {
  pepper: string;
  usdcType: string;
  bettingPackageId: string | undefined;
  verifyProof: (rawBody: string) => Promise<string>;
  shinami: ShinamiPort;
  /** Throws when a bet on this pool must be refused (GameLoop.assertBetAllowed). */
  assertBetAllowed: (poolId: string) => void;
};

export type WalletHandler = {
  matches(method: string, urlPath: string): boolean;
  handle(req: IncomingMessage, res: ServerResponse, method: string, urlPath: string): Promise<void>;
};

function readOptional(name: string, env: NodeJS.ProcessEnv): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") return undefined;
  return value.trim();
}

function bearer(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (header === undefined) {
    throw new HttpError(401, "Session is required. Call POST /auth/world-id.");
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !value.startsWith("Bearer ")) {
    throw new HttpError(401, "Session is required. Call POST /auth/world-id.");
  }
  const token = value.slice("Bearer ".length).trim();
  if (token === "") throw new HttpError(401, "Session is required. Call POST /auth/world-id.");
  return token;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buf.length;
      if (size > BODY_LIMIT) {
        reject(new HttpError(400, `Request body exceeded ${String(BODY_LIMIT)} bytes.`));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (err: Error) => reject(err));
  });
}

function redact(message: string, pepper: string, secret: string): string {
  let text = message;
  if (pepper !== "") text = text.split(pepper).join("[redacted]");
  if (secret !== "") text = text.split(secret).join("[redacted]");
  return text;
}

async function openWallet(
  deps: WalletHandlerDeps,
  nullifier: string,
): Promise<{ address: string; sessionToken: string }> {
  const secret = walletSecret(nullifier, deps.pepper);
  const sessionToken = await deps.shinami.createSession(secret);
  try {
    const address = await deps.shinami.createWallet(nullifier, sessionToken);
    return { address, sessionToken };
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    if (!isWalletAlreadyExists(error)) throw error;
    const address = await deps.shinami.getWallet(nullifier);
    return { address, sessionToken };
  }
}

function preflight(res: ServerResponse): void {
  res.writeHead(204, {
    "access-control-allow-headers": "authorization, content-type",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-origin": "*",
    "access-control-max-age": "600",
  });
  res.end();
}

export function createWalletHandler(deps: WalletHandlerDeps): WalletHandler {
  normalizeStructTag(deps.usdcType);
  if (deps.bettingPackageId !== undefined) normalizeSuiAddress(deps.bettingPackageId);

  return {
    matches(method: string, urlPath: string): boolean {
      return ROUTES.has(urlPath) && (method === "POST" || method === "OPTIONS");
    },
    async handle(
      req: IncomingMessage,
      res: ServerResponse,
      method: string,
      urlPath: string,
    ): Promise<void> {
      if (method === "OPTIONS") {
        preflight(res);
        return;
      }
      let secret = "";
      try {
        if (urlPath === "/auth/world-id") {
          const raw = await readBody(req);
          let parsedProof;
          try {
            parsedProof = v.safeParse(v.record(v.string(), v.any()), JSON.parse(raw));
          } catch (err) {
            throw new HttpError(
              400,
              `Request body is not JSON. Underlying: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          if (!parsedProof.success) throw new HttpError(400, "World ID proof must be a JSON object.");
          const nullifier = await deps.verifyProof(raw);
          sendJson(res, 200, { session: issueSession(nullifier, deps.pepper) });
          return;
        }
        const nullifier = readSession(bearer(req), deps.pepper);
        secret = walletSecret(nullifier, deps.pepper);
        if (urlPath === "/wallet") {
          const opened = await openWallet(deps, nullifier);
          console.log(`POST /wallet ${opened.address}`);
          sendJson(res, 200, { address: opened.address });
          return;
        }
        const raw = await readBody(req);
        let parsedTx;
        try {
          parsedTx = v.safeParse(TxBody, JSON.parse(raw));
        } catch (err) {
          throw new HttpError(
            400,
            `Request body is not JSON. Underlying: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (!parsedTx.success) {
          throw new HttpError(400, "POST /tx requires txKind, the base64 transaction kind bytes.");
        }
        const opened = await openWallet(deps, nullifier);
        assertSponsorableKind(
          parsedTx.output.txKind,
          opened.address,
          deps.usdcType,
          deps.bettingPackageId,
        );
        if (deps.bettingPackageId !== undefined) {
          for (const poolId of betPoolIds(parsedTx.output.txKind, deps.bettingPackageId)) {
            try {
              deps.assertBetAllowed(poolId);
            } catch (err) {
              throw new HttpError(409, err instanceof Error ? err.message : String(err));
            }
          }
        }
        let digest: string;
        try {
          digest = await deps.shinami.executeGaslessTransaction(
            nullifier,
            opened.sessionToken,
            parsedTx.output.txKind,
          );
        } catch (err) {
          throw gaslessError(err instanceof Error ? err : new Error(String(err)));
        }
        console.log(`POST /tx ${digest}`);
        sendJson(res, 200, { digest });
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const status = error instanceof HttpError ? error.status : 500;
        const message = redact(error.message, deps.pepper, secret);
        console.error(`POST ${urlPath} failed: ${message}`);
        if (!res.headersSent) sendJson(res, status, { error: message });
      }
    },
  };
}

export function createWalletHandlerFromEnv(
  env: NodeJS.ProcessEnv,
  assertBetAllowed: (poolId: string) => void,
  fetchImpl: typeof fetch = fetch,
): WalletHandler {
  const accessKey = requiredEnv("SHINAMI_ACCESS_KEY", env);
  const pepper = requiredEnv("WALLET_SECRET_PEPPER", env);
  const usdcType = requiredEnv("SUI_USDC_TYPE", env);
  let bettingPackageId: string | undefined;
  try {
    bettingPackageId = readOptional("BETTING_PACKAGE_ID", env);
    if (bettingPackageId !== undefined) normalizeSuiAddress(bettingPackageId);
    normalizeStructTag(usdcType);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`SUI_USDC_TYPE or BETTING_PACKAGE_ID is invalid. Underlying: ${detail}`);
  }
  const fetchAdapter: VerifyFetch = (input, init) => fetchImpl(input, init);
  return createWalletHandler({
    pepper,
    usdcType,
    bettingPackageId,
    verifyProof: async (rawBody: string) => {
      try {
        const verified = await verifyEnterRoomProof(JSON.parse(rawBody), {
          env,
          fetch: fetchAdapter,
        });
        return verified.nullifier;
      } catch (err) {
        if (err instanceof HttpError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        if (err instanceof SyntaxError) {
          throw new HttpError(400, `Request body is not JSON. Underlying: ${message}`);
        }
        const status = /HTTP 5\d\d|non-JSON/u.test(message) ? 502 : 401;
        throw new HttpError(status, message);
      }
    },
    shinami: shinamiPort(accessKey),
    assertBetAllowed,
  });
}
