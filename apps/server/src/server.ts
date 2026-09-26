import { createReadStream, existsSync, statSync } from "node:fs";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

export type GameServerOptions = {
  port: number;
  host: string;
  staticDir?: string;
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

function sendJson(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function resolveStaticPath(staticDir: string, urlPath: string): string | null {
  const decoded = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\//u, "");
  const candidate = normalize(join(staticDir, relative));
  const root = resolve(staticDir) + sep;
  if (!candidate.startsWith(root) && candidate !== resolve(staticDir)) {
    return null;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    return null;
  }
  return candidate;
}

function serveStatic(
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): void {
  const filePath = resolveStaticPath(staticDir, urlPath);
  if (filePath === null) {
    sendNotFound(res);
    return;
  }
  const type = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  createReadStream(filePath).pipe(res);
}

export function createGameServer(options: GameServerOptions): Server {
  const { staticDir } = options;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    if (method === "GET" && (url === "/health" || url.startsWith("/health?"))) {
      sendJson(res, 200, { ok: true });
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

export function listenGameServer(
  server: Server,
  options: GameServerOptions,
): Promise<Server> {
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolvePromise(server);
    });
  });
}
