import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import type { WalletHandler } from "./wallet-handler.js";

export type GameServerOptions = {
  port: number;
  host: string;
  staticDir?: string;
  wallet?: WalletHandler;
};

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export type JsonBody =
  | { ok: true }
  | { error: string }
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

function sendBadRequest(res: ServerResponse): void {
  sendText(res, 400, "Bad Request");
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
  const type = CONTENT_TYPES[extname(resolved.path).toLowerCase()] ?? "application/octet-stream";
  // Open first; only send 200 after the fd is open so open/read errors can be 500.
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

export function createGameServer(options: GameServerOptions): Server {
  const { staticDir, wallet } = options;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const urlPath = url.split("?")[0] ?? "/";

    if (method === "GET" && (url === "/health" || url.startsWith("/health?"))) {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (wallet !== undefined && wallet.matches(method, urlPath)) {
      void wallet.handle(req, res, method, urlPath).catch((err: Error) => {
        console.error(err);
        if (!res.headersSent) sendJson(res, 500, { error: "Internal Server Error" });
      });
      return;
    }

    if (staticDir !== undefined && method === "GET") {
      serveStatic(res, staticDir, url);
      return;
    }

    sendNotFound(res);
  });

  return server;
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
