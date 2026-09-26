import * as v from "valibot";

const RosterSheet = v.object({
  label: v.pipe(v.string(), v.minLength(1)),
  display_name: v.string(),
  name: v.string(),
  owner: v.string(),
  look: v.string(),
  brief: v.string(),
  injury_places: v.array(v.string()),
  injuries: v.array(v.string()),
  status: v.string(),
  icon: v.string(),
});

const RosterBody = v.object({
  parentName: v.pipe(v.string(), v.minLength(1)),
  sheets: v.array(RosterSheet),
});

export type RosterSheet = v.InferOutput<typeof RosterSheet>;
export type RosterResponse = v.InferOutput<typeof RosterBody>;

export async function fetchRoster(fetchFn: typeof fetch = fetch): Promise<RosterResponse> {
  const res = await fetchFn("/roster");
  if (!res.ok) {
    throw new Error(
      `GET /roster failed: HTTP ${String(res.status)} ${res.statusText}: ${await res.text()}`,
    );
  }
  try {
    return v.parse(RosterBody, await res.json());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`GET /roster body is not a roster: ${detail}`, { cause });
  }
}
