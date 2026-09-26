import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { downloadFightVideoBytes } from "../src/store-video.js";

describe("downloadFightVideoBytes", () => {
  it("returns bytes from an explicit fake HTTP boundary", async () => {
    const payload = new Uint8Array([0x00, 0x01, 0x02, 0xff]);
    const bytes = await downloadFightVideoBytes(
      "https://v3b.fal.media/files/b/example/fight.mp4",
      async (url) => {
        assert.equal(url, "https://v3b.fal.media/files/b/example/fight.mp4");
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ),
        };
      },
    );
    assert.deepEqual(bytes, payload);
  });

  it("rejects a blank URL without calling fetch", async () => {
    await assert.rejects(
      () =>
        downloadFightVideoBytes("  ", async () => {
          throw new Error("fetch must not be called for a blank URL");
        }),
      { name: "FightError", message: /blank/u },
    );
  });

  it("fails on non-OK HTTP and does not return bytes", async () => {
    await assert.rejects(
      () =>
        downloadFightVideoBytes("https://v3b.fal.media/gone.mp4", async () => ({
          ok: false,
          status: 404,
          statusText: "Not Found",
          arrayBuffer: async () => {
            throw new Error("arrayBuffer must not be read on non-OK");
          },
        })),
      /HTTP 404 Not Found/u,
    );
  });

  it("rejects an empty body", async () => {
    await assert.rejects(
      () =>
        downloadFightVideoBytes("https://v3b.fal.media/empty.mp4", async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => new ArrayBuffer(0),
        })),
      /empty body/u,
    );
  });

  it("surfaces transport errors without keeping the fal URL", async () => {
    await assert.rejects(
      () =>
        downloadFightVideoBytes("https://v3b.fal.media/down.mp4", async () => {
          throw new Error("ECONNRESET");
        }),
      /ECONNRESET.*Refusing to keep a fal URL/u,
    );
  });
});
