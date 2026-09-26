import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import * as v from "valibot";

import { StoreWriteError, type GameLoop } from "./game/loop.js";
import { HttpError, type HttpErrorBody } from "./http-error.js";
import { readSession } from "./human-session.js";
import type { RoundState } from "./types.js";
import type { WalletHandler } from "./wallet-handler.js";
import { handleWorldIdRequest, type WorldIdHandlerDeps } from "./world-id-handler.js";

const PlaybackStartBody = v.object({
  battleId: v.pipe(v.string(), v.trim(), v.minLength(1)),
});

const VoteBody = v.object({
  picks: v.pipe(
    v.array(v.unknown()),
    v.transform((picks) => picks.map(Number)),
  ),
});

export type GameServerOptions = {
  port: number;
  host: string;
  staticDir?: string;
  wallet?: WalletHandler;
  worldId?: WorldIdHandlerDeps;
  game?: GameLoop;
  sessionPepper?: string;
  betting?: {
    packageId: string;
    houseId: string;
    coinType: string;
    network: string;
    feeBps: number;
  };
};

const CONTENT_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mp4", "video/mp4"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
]);

export type JsonBody =
  | { ok: true }
  | { ok: false; error: string }
  | HttpErrorBody
  | { session: string }
  | { address: string }
  | { digest: string };

export function sendJson(res: ServerResponse, status: number, body: JsonBody): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "access-control-allow-origin": "*",
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendText(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function sendNotFound(res: ServerResponse): void {
  sendText(res, 404, "Not Found");
}

function sendBadRequest(res: ServerResponse, message = "Bad Request"): void {
  sendText(res, 400, message);
}

function sendInternalError(res: ServerResponse): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendText(res, 500, "Internal Server Error");
}

type StaticPathResult =
  | { kind: "file"; path: string }
  | { kind: "missing" }
  | { kind: "bad-encoding" };

function resolveStaticPath(staticDir: string, urlPath: string): StaticPathResult {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  } catch {
    return { kind: "bad-encoding" };
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\//u, "");
  const root = resolve(staticDir);
  const candidate = resolve(staticDir, relative);
  const rootPrefix = root.endsWith(sep) ? root : root + sep;
  if (!candidate.startsWith(rootPrefix) && candidate !== root) {
    return { kind: "missing" };
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    return { kind: "missing" };
  }
  return { kind: "file", path: candidate };
}

function serveStatic(res: ServerResponse, staticDir: string, urlPath: string): void {
  const resolved = resolveStaticPath(staticDir, urlPath);
  if (resolved.kind === "bad-encoding") {
    sendBadRequest(res);
    return;
  }
  if (resolved.kind === "missing") {
    sendNotFound(res);
    return;
  }
  const type =
    CONTENT_TYPES.get(extname(resolved.path).toLowerCase()) ?? "application/octet-stream";
  const stream = createReadStream(resolved.path);
  stream.once("open", () => {
    if (res.headersSent || res.writableEnded) {
      stream.destroy();
      return;
    }
    res.writeHead(200, { "content-type": type });
    stream.pipe(res);
  });
  stream.on("error", (err) => {
    console.error(
      `static file read failed for ${resolved.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
    sendInternalError(res);
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      resolveBody(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

function serveRoundStateSse(res: ServerResponse, game: GameLoop): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const send = (state: RoundState): void => {
    res.write(`event: round\ndata: ${JSON.stringify(state)}\n\n`);
  };
  const unsubscribe = game.subscribe(send);
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);
  res.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}

function readBearerToken(req: IncomingMessage): string {
  const header = req.headers.authorization;
  if (header === undefined) {
    throw new HttpError(401, "Authorization Bearer session is required. Call POST /auth/world-id.");
  }
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined || !value.startsWith("Bearer ")) {
    throw new HttpError(401, "Authorization Bearer session is required. Call POST /auth/world-id.");
  }
  const token = value.slice("Bearer ".length).trim();
  if (token === "") {
    throw new HttpError(401, "Authorization Bearer session is required. Call POST /auth/world-id.");
  }
  return token;
}

function sessionNullifier(
  req: IncomingMessage,
  res: ServerResponse,
  pepper: string | undefined,
): string | null {
  if (pepper === undefined || pepper.trim() === "") {
    sendJson(res, 500, {
      ok: false,
      error: "WALLET_SECRET_PEPPER is required. Set it in .env. See .env.example.",
    });
    return null;
  }
  try {
    return readSession(readBearerToken(req), pepper);
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 401;
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, status, { ok: false, error: message });
    return null;
  }
}

function sendState(res: ServerResponse, state: RoundState): void {
  const payload = JSON.stringify({ ok: true, state });
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function createGameServer(options: GameServerOptions): Server {
  const { staticDir, wallet, worldId, game, sessionPepper, betting } = options;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleRequest(req, res, {
      staticDir,
      wallet,
      worldId,
      game,
      sessionPepper,
      betting,
    });
  });

  return server;
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: {
    staticDir?: string;
    wallet?: WalletHandler;
    worldId?: WorldIdHandlerDeps;
    game?: GameLoop;
    sessionPepper?: string;
    betting?: GameServerOptions["betting"];
  },
): Promise<void> {
  const method = req.method ?? "GET";
  const url = req.url ?? "/";
  const path = url.split("?")[0] ?? "/";

  try {
    if (method === "GET" && (path === "/health" || url.startsWith("/health?"))) {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (opts.wallet !== undefined && opts.wallet.matches(method, path)) {
      try {
        await opts.wallet.handle(req, res, method, path);
      } catch (err) {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: "Internal Server Error" });
      }
      return;
    }

    if (opts.game !== undefined) {
      if (method === "GET" && path === "/round") {
        const payload = JSON.stringify(opts.game.getState());
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      if (method === "GET" && path === "/events") {
        serveRoundStateSse(res, opts.game);
        return;
      }
      if (method === "POST" && path === "/playback-start") {
        if (sessionNullifier(req, res, opts.sessionPepper) === null) return;
        let parsed;
        try {
          parsed = v.safeParse(PlaybackStartBody, JSON.parse(await readBody(req)));
        } catch {
          sendJson(res, 400, { ok: false, error: "playback-start body must be JSON." });
          return;
        }
        if (!parsed.success) {
          sendJson(res, 400, {
            ok: false,
            error: "playback-start.battleId must be the live RoundState.battleId.",
          });
          return;
        }
        try {
          await opts.game.reportPlaybackStart(parsed.output.battleId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`POST /playback-start failed: ${message}`);
          sendJson(res, err instanceof StoreWriteError ? 500 : 409, {
            ok: false,
            error: message,
          });
          return;
        }
        sendState(res, opts.game.getState());
        return;
      }
      if (method === "POST" && path === "/vote") {
        const nullifier = sessionNullifier(req, res, opts.sessionPepper);
        if (nullifier === null) return;
        const raw = await readBody(req);
        let body;
        try {
          body = v.safeParse(VoteBody, JSON.parse(raw));
        } catch {
          sendJson(res, 400, { ok: false, error: "vote body must be JSON." });
          return;
        }
        if (!body.success) {
          sendJson(res, 400, {
            ok: false,
            error: "vote.picks must be an array of character ids.",
          });
          return;
        }
        const picks = body.output.picks;
        if (picks.some((p) => !Number.isInteger(p))) {
          sendJson(res, 400, { ok: false, error: "vote.picks must be integers." });
          return;
        }
        try {
          await opts.game.voteWithNullifier(nullifier, picks);
          sendState(res, opts.game.getState());
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (err instanceof StoreWriteError) console.error(`POST /vote failed: ${message}`);
          sendJson(res, err instanceof StoreWriteError ? 500 : 400, { ok: false, error: message });
        }
        return;
      }
      if (method === "GET" && path === "/betting") {
        const cfg = opts.betting;
        if (cfg === undefined) {
          sendText(res, 500, "Betting config is not configured on this server.");
          return;
        }
        const payload = JSON.stringify({
          packageId: cfg.packageId,
          houseId: cfg.houseId,
          coinType: cfg.coinType,
          network: cfg.network,
          feeBps: cfg.feeBps,
        });
        res.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "content-length": Buffer.byteLength(payload),
        });
        res.end(payload);
        return;
      }
      if (method === "POST" && path === "/retry-settle") {
        try {
          await opts.game.retrySettle();
          const payload = JSON.stringify({
            ok: true,
            state: opts.game.getState(),
          });
          res.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
          });
          res.end(payload);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sendJson(res, 400, { ok: false, error: message });
        }
        return;
      }
    }

    const handled = await handleWorldIdRequest(req, res, opts.worldId ?? {});
    if (handled || res.headersSent) return;

    if (opts.staticDir !== undefined && method === "GET") {
      serveStatic(res, opts.staticDir, url);
      return;
    }

    sendNotFound(res);
  } catch (err) {
    console.error(`request handler failed: ${err instanceof Error ? err.message : String(err)}`);
    sendInternalError(res);
  }
}

export function listenGameServer(server: Server, options: GameServerOptions): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolvePromise(server);
    });
  });
}
