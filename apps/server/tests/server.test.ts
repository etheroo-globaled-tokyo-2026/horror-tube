import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import type { AddressInfo } from "node:net";

import { readGamePort, readStaticDir, requiredEnv } from "../src/env.js";
import { createGameServer, listenGameServer } from "../src/server.js";

describe("GAME_PORT", () => {
  it("throws and names GAME_PORT when missing", () => {
    assert.throws(
      () => readGamePort({}),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /GAME_PORT/u);
        assert.match(err.message, /\.env\.example/u);
        return true;
      },
    );
  });

  it("throws and names GAME_PORT when blank", () => {
    assert.throws(
      () => readGamePort({ GAME_PORT: "   " }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /GAME_PORT/u);
        assert.match(err.message, /\.env\.example/u);
        return true;
      },
    );
  });

  it("requiredEnv names the variable", () => {
    assert.throws(
      () => requiredEnv("GAME_PORT", {}),
      /GAME_PORT is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });
});

describe("STATIC_DIR", () => {
  it("returns undefined when unset", () => {
    assert.equal(readStaticDir({}), undefined);
    assert.equal(readStaticDir({ STATIC_DIR: "" }), undefined);
  });

  it("throws when STATIC_DIR points at a missing path", () => {
    assert.throws(
      () =>
        readStaticDir({
          STATIC_DIR: join(tmpdir(), `horror-tube-missing-${String(Date.now())}`),
        }),
      /STATIC_DIR/u,
    );
  });
});

describe("HTTP server", () => {
  const servers: ReturnType<typeof createServer>[] = [];

  after(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
          }),
      ),
    );
  });

  it("GET /health returns 200 with GAME_PORT set", async () => {
    const server = createGameServer({ port: 0, host: "127.0.0.1" });
    servers.push(server);
    await listenGameServer(server, { port: 0, host: "127.0.0.1" });
    const addr = server.address() as AddressInfo;
    const res = await fetch(`http://127.0.0.1:${String(addr.port)}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  });

  it("serves a file from STATIC_DIR when the directory exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "horror-tube-static-"));
    try {
      await writeFile(join(dir, "hello.txt"), "from-static\n", "utf8");
      const staticDir = readStaticDir({ STATIC_DIR: dir });
      assert.equal(staticDir, dir);

      const server = createGameServer({
        port: 0,
        host: "127.0.0.1",
        staticDir,
      });
      servers.push(server);
      await listenGameServer(server, { port: 0, host: "127.0.0.1", staticDir });
      const addr = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${String(addr.port)}/hello.txt`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "from-static\n");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 400 for a badly encoded static path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "horror-tube-static-bad-"));
    try {
      await writeFile(join(dir, "ok.txt"), "ok\n", "utf8");
      const staticDir = readStaticDir({ STATIC_DIR: dir });
      const server = createGameServer({
        port: 0,
        host: "127.0.0.1",
        staticDir,
      });
      servers.push(server);
      await listenGameServer(server, { port: 0, host: "127.0.0.1", staticDir });
      const addr = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${String(addr.port)}/%E0%A4%A`);
      assert.equal(res.status, 400);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serves files when STATIC_DIR is a relative path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "horror-tube-static-rel-"));
    const prev = process.cwd();
    try {
      await writeFile(join(dir, "rel.txt"), "relative\n", "utf8");
      process.chdir(dir);
      const staticDir = readStaticDir({ STATIC_DIR: "." });
      assert.equal(staticDir, ".");
      const server = createGameServer({
        port: 0,
        host: "127.0.0.1",
        staticDir,
      });
      servers.push(server);
      await listenGameServer(server, { port: 0, host: "127.0.0.1", staticDir });
      const addr = server.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${String(addr.port)}/rel.txt`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "relative\n");
    } finally {
      process.chdir(prev);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
