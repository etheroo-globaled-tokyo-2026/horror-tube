import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchReplayVideoUrl } from "../round-client.ts";
import { playReplayVideo } from "../replay-video.ts";

describe("fetchReplayVideoUrl", () => {
  it("returns the Spaces CDN URL from GET /replay", async () => {
    const url = "https://cdn.example/videos/fight.mp4";
    const fetchImpl: typeof fetch = async (input) => {
      assert.equal(String(input), "/replay");
      return new Response(JSON.stringify({ videoUrl: url }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    assert.equal(await fetchReplayVideoUrl(fetchImpl), url);
  });

  it("surfaces the server error when no fight video is stored", async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(
        JSON.stringify({ ok: false, error: "no fight video is stored. Play a bout first." }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    await assert.rejects(() => fetchReplayVideoUrl(fetchImpl), /no fight video is stored/u);
  });
});

describe("playReplayVideo", () => {
  it("sets the video src from GET /replay", async () => {
    const url = "https://cdn.example/videos/replay.mp4";
    let src: string | null = null;
    const notes: string[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ videoUrl: url }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await playReplayVideo(
      {
        get currentSrc() {
          return src;
        },
        setSrc(next) {
          src = next;
        },
        note(text) {
          notes.push(text);
        },
      },
      fetchImpl,
    );
    assert.equal(src, url);
    assert.deepEqual(notes, []);
  });

  it("notes a failed /replay and does not set a placeholder src", async () => {
    let src: string | null = null;
    const notes: string[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ ok: false, error: "no fight video is stored." }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    await playReplayVideo(
      {
        get currentSrc() {
          return src;
        },
        setSrc(next) {
          src = next;
        },
        note(text, kind) {
          notes.push(`${kind ?? ""}:${text}`);
        },
      },
      fetchImpl,
    );
    assert.equal(src, null);
    assert.equal(notes.length, 1);
    assert.match(notes[0] ?? "", /^bad:REPLAY FAILED\..*no fight video is stored/u);
  });
});
