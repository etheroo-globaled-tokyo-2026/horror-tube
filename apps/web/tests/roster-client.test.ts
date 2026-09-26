import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fetchRoster } from "../roster-client.ts";

const sheet = {
  label: "jason",
  display_name: "Jason",
  name: "jason.horrortube.eth",
  owner: "0x1111111111111111111111111111111111111111",
  look: "masked",
  brief: "walks",
  injury_places: ["arm"],
  injuries: [],
  status: "alive",
  icon: "https://cdn.example/jason.png",
};

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    statusText: status === 200 ? "OK" : "Internal Server Error",
  });
}

describe("fetchRoster", () => {
  it("returns the sheets from GET /roster", async () => {
    const fetchFn: typeof fetch = async () =>
      jsonResponse(JSON.stringify({ parentName: "horrortube.eth", sheets: [sheet] }));
    const roster = await fetchRoster(fetchFn);
    assert.equal(roster.parentName, "horrortube.eth");
    assert.equal(roster.sheets[0]?.label, "jason");
    assert.deepEqual(roster.sheets[0]?.injuries, []);
  });

  it("rejects a body that is not a roster", async () => {
    const missingSheets: typeof fetch = async () =>
      jsonResponse(JSON.stringify({ parentName: "horrortube.eth" }));
    await assert.rejects(() => fetchRoster(missingSheets), /sheets/u);
    const missingName: typeof fetch = async () =>
      jsonResponse(
        JSON.stringify({
          parentName: "horrortube.eth",
          sheets: [{ label: "jason" }],
        }),
      );
    await assert.rejects(() => fetchRoster(missingName), /display_name/u);
  });

  it("throws the HTTP status and body when the server refuses", async () => {
    const fetchFn: typeof fetch = async () =>
      jsonResponse("ENS roster cache is not configured.", 500);
    await assert.rejects(() => fetchRoster(fetchFn), /GET \/roster failed: HTTP 500/u);
  });
});
