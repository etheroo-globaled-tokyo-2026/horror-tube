import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { tornDraws, type Rect } from "../tv-tear.ts";

const EPSILON = 1e-9;

const within = ([x, y, w, h]: Rect, [ox, oy, ow, oh]: Rect): boolean =>
  x >= ox - EPSILON &&
  y >= oy - EPSILON &&
  x + w <= ox + ow + EPSILON &&
  y + h <= oy + oh + EPSILON;

const frames: [string, Rect, Rect][] = [
  ["a rotoscope pillarboxed in the replay strip", [0, 0, 256, 144], [110, 0, 420, 236]],
  ["a film filling the TV", [0, 0, 160, 120], [0, 0, 640, 480]],
];

describe("tornDraws", () => {
  for (const [name, from, to] of frames) {
    it(`keeps every band of ${name} inside its rectangle`, () => {
      for (const pick of [0, 0.5, 0.999]) {
        for (const [, drawnTo] of tornDraws(from, to, pick)) {
          assert.ok(
            within(drawnTo, to),
            `${JSON.stringify(drawnTo)} leaves ${JSON.stringify(to)} at pick ${String(pick)}`,
          );
        }
      }
    });
  }

  it("draws the shifted band at the frame's own scale", () => {
    for (const [name, from, to] of frames) {
      for (const [drawnFrom, drawnTo] of tornDraws(from, to, 0.5)) {
        assert.ok(
          Math.abs(drawnTo[2] / drawnFrom[2] - to[2] / from[2]) < EPSILON &&
            Math.abs(drawnTo[3] / drawnFrom[3] - to[3] / from[3]) < EPSILON,
          `${name}: ${JSON.stringify(drawnFrom)} → ${JSON.stringify(drawnTo)} is scaled differently from the frame`,
        );
      }
    }
  });
});
