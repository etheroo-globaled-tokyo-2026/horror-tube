import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import { loadRepoDotenv, readGamePort, readStaticDir } from "../src/env.js";
import { createGameServer, listenGameServer } from "../src/server.js";
import { baseUrl } from "./base-url.js";

describe("loadRepoDotenv", () => {
  it("does not require an env file to exist", () => {
    const missing = join(tmpdir(), `horror-tube-no-dotenv-${String(Date.now())}`);
    assert.deepEqual(loadRepoDotenv(missing), []);
  });

  it("lets .env.local override .env, and the shell override both", async () => {
    const dir = await mkdtemp(join(tmpdir(), "horror-tube-dotenv-"));
    const marker = `HT_DOTENV_TEST_${String(Date.now())}`;
    const base = `${marker}_BASE`;
    const local = `${marker}_LOCAL`;
    const shell = `${marker}_SHELL`;
    const names = [base, local, shell];
    try {
      await writeFile(join(dir, ".env"), `${base}=env\n${local}=env\n${shell}=env\n`, "utf8");
      await writeFile(join(dir, ".env.local"), `${local}=env-local\n${shell}=env-local\n`, "utf8");
      process.env[shell] = "shell";
      assert.deepEqual(loadRepoDotenv(dir), [".env.local", ".env"]);
      assert.deepEqual(
        names.map((name) => process.env[name]),
        ["env", "env-local", "shell"],
      );
    } finally {
      for (const name of names) delete process.env[name];
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("GAME_PORT", () => {
  it("throws and names GAME_PORT when missing", () => {
    assert.throws(
      () => readGamePort({}),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /GAME_PORT/u);
        assert.match(cause.message, /\.env\.example/u);
        return true;
      },
    );
  });

  it("throws and names GAME_PORT when blank", () => {
    assert.throws(
      () => readGamePort({ GAME_PORT: "   " }),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /GAME_PORT/u);
        assert.match(cause.message, /\.env\.example/u);
        return true;
      },
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
    const res = await fetch(`${baseUrl(server)}/health`);
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
      const res = await fetch(`${baseUrl(server)}/hello.txt`);
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
      const res = await fetch(`${baseUrl(server)}/%E0%A4%A`);
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
      const res = await fetch(`${baseUrl(server)}/rel.txt`);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), "relative\n");
    } finally {
      process.chdir(prev);
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns 500 for an unreadable static file and keeps serving /health", async () => {
    const dir = await mkdtemp(join(tmpdir(), "horror-tube-static-unreadable-"));
    const denied = join(dir, "denied.txt");
    try {
      await writeFile(denied, "secret\n", "utf8");
      await chmod(denied, 0o000);
      const staticDir = readStaticDir({ STATIC_DIR: dir });
      const server = createGameServer({
        port: 0,
        host: "127.0.0.1",
        staticDir,
      });
      servers.push(server);
      await listenGameServer(server, { port: 0, host: "127.0.0.1", staticDir });
      const base = baseUrl(server);
      const deniedRes = await fetch(`${base}/denied.txt`);
      assert.equal(deniedRes.status, 500);
      assert.equal(await deniedRes.text(), "Internal Server Error");
      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.deepEqual(await health.json(), { ok: true });
    } finally {
      await chmod(denied, 0o644).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    }
  });
});
