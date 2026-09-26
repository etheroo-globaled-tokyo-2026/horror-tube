import { IDKit, proofOfHuman, type IDKitResult } from "@worldcoin/idkit-core";
import * as v from "valibot";

const AppIdString = v.pipe(v.string(), v.startsWith("app_"));

const EnterRoomIdkitContext = v.object({
  app_id: v.custom<`app_${string}`>(
    (input) => v.is(AppIdString, input),
    "app_id must start with app_",
  ),
  action: v.literal("enter-room"),
  environment: v.optional(v.picklist(["production", "staging", "sandbox"])),
  allow_legacy_proofs: v.literal(false),
  rp_context: v.object({
    rp_id: v.string(),
    nonce: v.string(),
    created_at: v.number(),
    expires_at: v.number(),
    signature: v.string(),
  }),
});
export type EnterRoomIdkitContext = v.InferOutput<typeof EnterRoomIdkitContext>;

const VerifyResponse = v.object({ ok: v.literal(true) });

async function postWorldId<TSchema extends v.GenericSchema>(
  path: string,
  init: RequestInit,
  schema: TSchema,
): Promise<v.InferOutput<TSchema>> {
  const res = await fetch(path, { ...init, method: "POST" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${path} failed: HTTP ${String(res.status)} body=${text}`);
  }
  let parsed;
  try {
    parsed = v.safeParse(schema, JSON.parse(text));
  } catch (cause) {
    throw new Error(
      `POST ${path} returned non-JSON. Underlying: ${cause instanceof Error ? cause.message : String(cause)} body=${text}`,
      { cause },
    );
  }
  if (!parsed.success) {
    throw new Error(
      `POST ${path} returned an unexpected body: ${v.summarize(parsed.issues)} body=${text}`,
    );
  }
  return parsed.output;
}

export function fetchEnterRoomRequest(): Promise<EnterRoomIdkitContext> {
  return postWorldId("/world-id/request", {}, EnterRoomIdkitContext);
}

export async function startEnterRoomProof(context: EnterRoomIdkitContext) {
  const request = await IDKit.request({
    app_id: context.app_id,
    action: context.action,
    environment: context.environment,
    allow_legacy_proofs: false,
    rp_context: context.rp_context,
  }).preset(proofOfHuman());

  return {
    connectorURI: request.connectorURI,
    wait: async (): Promise<IDKitResult> => {
      const completion = await request.pollUntilCompletion({
        pollInterval: 2_000,
        timeout: 300_000,
      });
      if (!completion.success) {
        throw new Error(`World ID scan did not complete: ${String(completion.error)}`);
      }
      return completion.result;
    },
  };
}

export async function verifyEnterRoomProof(idkitResult: IDKitResult): Promise<void> {
  await postWorldId(
    "/world-id/verify",
    { headers: { "content-type": "application/json" }, body: JSON.stringify(idkitResult) },
    VerifyResponse,
  );
}
