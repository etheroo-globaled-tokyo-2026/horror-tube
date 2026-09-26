import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { CharacterSheet } from "@horror-tube/ens/roster";

import { readRosterRefreshMs } from "../src/env.js";
import {
  openEnsRosterCache,
  type RosterSnapshot,
} from "../src/ens-roster-cache.js";

const OWNER = "0x1111111111111111111111111111111111111111";

function sheet(label: string, status = "alive", look = "masked"): CharacterSheet {
  return {
    label,
    display_name: label,
    name: `${label}.horrortube.eth`,
    owner: OWNER,
    look,
    brief: "walks",
    injury_places: ["arm"],
    injuries: [],
    status,
    icon: "https://cdn.example/icon.png",
  };
}

function snap(sheets: CharacterSheet[]): RosterSnapshot {
  return { parentName: "horrortube.eth", sheets };
}

describe("readRosterRefreshMs", () => {
  it("names ENS_ROSTER_REFRESH_MS when the value is missing or not a positive integer", () => {
    for (const env of [
      {},
      { ENS_ROSTER_REFRESH_MS: "  " },
      { ENS_ROSTER_REFRESH_MS: "0" },
      { ENS_ROSTER_REFRESH_MS: "nope" },
    ]) {
      assert.throws(
        () => readRosterRefreshMs(env),
        /ENS_ROSTER_REFRESH_MS[\s\S]*\.env\.example/u,
      );
    }
  });

  it("returns the millisecond interval", () => {
    assert.equal(readRosterRefreshMs({ ENS_ROSTER_REFRESH_MS: "60000" }), 60000);
  });
});

describe("openEnsRosterCache", () => {
  it("fills once and serves that snapshot without reading again", async () => {
    let calls = 0;
    const cache = await openEnsRosterCache({
      refreshMs: 60000,
      schedule: () => ({ stop() {} }),
      read: async () => {
        calls += 1;
        return snap([sheet("jason")]);
      },
    });
    assert.equal(calls, 1);
    assert.equal(cache.snapshot().sheets[0]?.label, "jason");
    assert.deepEqual(cache.statuses(["jason"]), ["alive"]);
    cache.applyTextWrite("jason", "injuries", '["cut"]');
    assert.deepEqual(cache.sheet("jason").injuries, ["cut"]);
    assert.equal(calls, 1);
    cache.stop();
  });

  it("does not start the refresh timer when the first read fails", async () => {
    await assert.rejects(
      () =>
        openEnsRosterCache({
          refreshMs: 60000,
          schedule: () => {
            throw new Error("timer started after a failed fill");
          },
          read: async () => {
            throw new Error("sepolia down");
          },
        }),
      /sepolia down/u,
    );
  });

  it("keeps the filled roster when a later refresh fails", async () => {
    let calls = 0;
    const cache = await openEnsRosterCache({
      refreshMs: 60000,
      schedule: () => ({ stop() {} }),
      read: async () => {
        calls += 1;
        if (calls > 1) {
          throw new Error("rpc down");
        }
        return snap([sheet("jason")]);
      },
    });
    await assert.rejects(() => cache.refresh(), /rpc down/u);
    assert.equal(cache.snapshot().sheets.length, 1);
    cache.stop();
  });

  it("keeps a status written while a refresh is in flight", async () => {
    let release: () => void = () => {
      throw new Error("refresh gate was not installed");
    };
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const cache = await openEnsRosterCache({
      refreshMs: 60000,
      schedule: () => ({ stop() {} }),
      read: async () => {
        calls += 1;
        if (calls === 1) {
          return snap([sheet("jason", "alive")]);
        }
        await gate;
        return snap([sheet("jason", "alive"), sheet("freddy")]);
      },
    });
    const pending = cache.refresh();
    cache.applyTextWrite("jason", "status", "dead");
    release();
    await pending;
    const jason = cache.snapshot().sheets.find((item) => item.label === "jason");
    assert.equal(jason?.status, "dead");
    assert.ok(cache.snapshot().sheets.some((item) => item.label === "freddy"));
    cache.stop();
  });

  it("refuses a fight card that is dead, blank, or missing", () => {
    return openEnsRosterCache({
      refreshMs: 60000,
      schedule: () => ({ stop() {} }),
      read: async () =>
        snap([
          sheet("jason"),
          sheet("freddy", "dead"),
          sheet("chucky", "", ""),
          sheet("pinhead", "ghost"),
          sheet("michael", ""),
        ]),
    }).then((cache) => {
      assert.equal(cache.livingCards(["jason"])[0]?.status, "alive");
      assert.equal(cache.livingCards(["michael"])[0]?.status, "alive");
      assert.throws(() => cache.livingCards(["freddy"]), /dead/u);
      assert.throws(() => cache.livingCards(["chucky"]), /look/u);
      assert.throws(() => cache.livingCards(["pinhead"]), /ghost/u);
      assert.throws(() => cache.livingCards(["nope"]), /nope/u);
      assert.throws(() => cache.livingCards([]), /at least one subname/u);
      cache.stop();
    });
  });
});
