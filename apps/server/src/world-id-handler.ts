import {
  createIdkitRequestContext,
  enterRoomAction,
  loadWorldIdEnv,
  verifyProofOfHuman,
  type IdkitRequestContext,
  type IdkitResultJson,
  type VerifyFetch,
  type VerifiedHuman,
} from "@horror-tube/world-id";
import type { IncomingMessage, ServerResponse } from "node:http";
import { text } from "node:stream/consumers";

export type WorldIdHandlerDeps = {
  env?: NodeJS.ProcessEnv;
  fetch?: VerifyFetch;
};

type WorldIdResponseBody = IdkitRequestContext | ({ ok: true } & VerifiedHuman);

function sendJson(res: ServerResponse, status: number, body: WorldIdResponseBody): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

export function createEnterRoomRequest(env: NodeJS.ProcessEnv = process.env): IdkitRequestContext {
  loadWorldIdEnv(env);
  return createIdkitRequestContext({ action: enterRoomAction(), env });
}

export async function verifyEnterRoomProof(
  idkitResult: IdkitResultJson,
  deps: WorldIdHandlerDeps = {},
): Promise<VerifiedHuman> {
  const env = deps.env ?? process.env;
  const worldId = loadWorldIdEnv(env);
  const fetchImpl: VerifyFetch = deps.fetch ?? ((input, init) => fetch(input, init));
  return verifyProofOfHuman({
    rpId: worldId.rpId,
    environment: worldId.environment,
    stagingToken: worldId.stagingToken,
    action: enterRoomAction(),
    signal: null,
    idkitResult,
    fetch: fetchImpl,
  });
}

export async function handleWorldIdRequest(
  req: IncomingMessage,
  res: ServerResponse,
  deps: WorldIdHandlerDeps = {},
): Promise<boolean> {
  const method = req.method ?? "GET";
  const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
  const env = deps.env ?? process.env;

  if (urlPath === "/world-id/request" && method === "POST") {
    try {
      const context = createEnterRoomRequest(env);
      sendJson(res, 200, context);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`POST /world-id/request failed: ${message}`);
      sendText(res, 500, message);
    }
    return true;
  }

  if (urlPath === "/world-id/verify" && method === "POST") {
    let raw: string;
    try {
      raw = await text(req);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`POST /world-id/verify body read failed: ${message}`);
      sendText(res, 400, `Could not read body. Underlying: ${message}`);
      return true;
    }
    let idkitResult: IdkitResultJson;
    try {
      idkitResult = JSON.parse(raw);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      sendText(res, 400, `Body must be JSON. Underlying: ${message}`);
      return true;
    }
    try {
      const verified = await verifyEnterRoomProof(idkitResult, deps);
      sendJson(res, 200, { ok: true, action: verified.action, nullifier: verified.nullifier });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`POST /world-id/verify failed: ${message}`);
      sendText(res, 401, message);
    }
    return true;
  }

  return false;
}
