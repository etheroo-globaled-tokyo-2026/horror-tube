import { IDKit, proofOfHuman, type IDKitRequestConfig } from "@worldcoin/idkit-core";

export type EnterRoomIdkitContext = IDKitRequestConfig & {
  action: string;
  allow_legacy_proofs: false;
};

export async function fetchEnterRoomRequest(): Promise<EnterRoomIdkitContext> {
  const res = await fetch("/world-id/request", { method: "POST" });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /world-id/request failed: HTTP ${String(res.status)} body=${text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(
      `POST /world-id/request returned non-JSON. Underlying: ${err instanceof Error ? err.message : String(err)} body=${text}`,
      { cause: err },
    );
  }
  const body = parsed as EnterRoomIdkitContext;
  if (
    typeof body !== "object" ||
    body === null ||
    body.allow_legacy_proofs !== false ||
    body.action !== "enter-room" ||
    typeof body.app_id !== "string" ||
    body.environment === undefined ||
    typeof body.rp_context?.signature !== "string"
  ) {
    throw new Error(`POST /world-id/request returned an invalid IDKit context. body=${text}`);
  }
  return body;
}

export async function startEnterRoomProof(
  context: EnterRoomIdkitContext,
): Promise<{ connectorURI: string; wait: () => Promise<unknown> }> {
  const request = await IDKit.request({
    app_id: context.app_id,
    action: context.action,
    environment: context.environment,
    allow_legacy_proofs: false,
    rp_context: context.rp_context,
  }).preset(proofOfHuman());

  return {
    connectorURI: request.connectorURI,
    wait: async () => {
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

export async function verifyEnterRoomProof(idkitResult: unknown): Promise<void> {
  const res = await fetch("/world-id/verify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResult),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST /world-id/verify failed: HTTP ${String(res.status)} body=${text}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (err) {
    throw new Error(
      `POST /world-id/verify returned non-JSON. Underlying: ${err instanceof Error ? err.message : String(err)} body=${text}`,
      { cause: err },
    );
  }
  const body = parsed as { ok?: boolean };
  if (body.ok !== true) {
    throw new Error(`POST /world-id/verify did not confirm ok. body=${text}`);
  }
}
