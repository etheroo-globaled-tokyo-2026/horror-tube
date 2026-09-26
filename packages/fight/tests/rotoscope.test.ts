import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { buffer } from "node:stream/consumers";
import { describe, it } from "node:test";

import { FightError } from "../src/env.js";
import { RotoscopeError, rotoscopeVideo } from "../src/rotoscope.js";
import { buildShotList } from "../src/shot-list.js";
import { sampleFightInput, validModelTurn } from "./fixtures.js";

const FILM = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
const DRAWN = new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0xd7]);
const shotList = buildShotList(validModelTurn().shots, sampleFightInput());

type Received = { method: string | undefined; path: string | undefined; form: FormData };

/** A stand-in for `rotoscope serve`: records each multipart request, then answers with `answer`. */
async function withService(
  answer: (res: ServerResponse) => void,
  run: (url: string, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    void buffer(req).then(async (body) => {
      const form = await new Response(new Uint8Array(body), {
        headers: { "content-type": req.headers["content-type"] ?? "" },
      }).formData();
      received.push({ method: req.method, path: req.url, form });
      answer(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${String(address.port)}`, received);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function rejectsWith(
  run: () => Promise<unknown>,
  check: (err: RotoscopeError) => void,
): Promise<void> {
  return assert.rejects(run, (err: unknown) => {
    assert.ok(err instanceof RotoscopeError);
    assert.ok(err instanceof FightError);
    check(err);
    return true;
  });
}

describe("rotoscopeVideo", () => {
  it("posts the video and the shot list as multipart and returns the drawing with the service's counts", async () => {
    const drawn = (res: ServerResponse) => {
      res.writeHead(200, {
        "content-type": "video/mp4",
        "x-rotoscope-frames": "75",
        "x-rotoscope-seconds": "42.5",
      });
      res.end(DRAWN);
    };
    await withService(drawn, async (url, received) => {
      const result = await rotoscopeVideo(FILM, shotList, { url, timeoutMs: 5_000 });

      assert.deepEqual(result, { video: DRAWN, frames: 75, seconds: 42.5 });
      const [request] = received;
      assert.equal(request?.method, "POST");
      assert.equal(request?.path, "/v1/rotoscope");
      const video = request?.form.get("video");
      assert.ok(video instanceof Blob);
      assert.deepEqual(new Uint8Array(await video.arrayBuffer()), FILM);
      const shots = request?.form.get("shots");
      assert.ok(typeof shots === "string");
      assert.deepEqual(JSON.parse(shots), shotList);
    });
  });

  it("turns a non-200 answer into a FightError carrying the service's JSON error", async () => {
    const serviceError = { error: "segmenter failed", detail: { frame: 12 } };
    const failing = (res: ServerResponse) => {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify(serviceError));
    };
    await withService(failing, async (url) => {
      await rejectsWith(
        () => rotoscopeVideo(FILM, shotList, { url, timeoutMs: 5_000 }),
        (err) => {
          assert.equal(err.status, 500);
          assert.deepEqual(err.serviceError, serviceError);
          assert.match(err.message, /HTTP 500 .*segmenter failed \{"frame":12\}/);
        },
      );
    });
  });

  it("gives up on a service that doesn't answer within the timeout", async () => {
    await withService(
      () => {},
      async (url) => {
        await rejectsWith(
          () => rotoscopeVideo(FILM, shotList, { url, timeoutMs: 50 }),
          (err) => {
            assert.equal(err.status, null);
            assert.match(err.message, /did not answer within 50 ms \(ROTOSCOPE_TIMEOUT_MS\)/);
          },
        );
      },
    );
  });

  it("names the cause when nothing listens at ROTOSCOPE_URL", async () => {
    let closedUrl = "";
    await withService(
      () => {},
      async (url) => {
        closedUrl = url;
      },
    );
    await rejectsWith(
      () => rotoscopeVideo(FILM, shotList, { url: closedUrl, timeoutMs: 5_000 }),
      (err) => {
        assert.equal(err.status, null);
        assert.match(err.message, /could not be reached: .*ECONNREFUSED/);
      },
    );
  });
});
