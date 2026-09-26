export const WORLD_ID_VERIFY_URL_BASE =
  "https://developer.world.org/api/v4/verify" as const;

export const PROOF_OF_HUMAN_IDENTIFIER = "proof_of_human" as const;

export type IdkitResponseItem = {
  identifier: string;
  nullifier?: string;
};

export type IdkitResultPayload = {
  protocol_version: string;
  nonce: string;
  action: string;
  responses: IdkitResponseItem[];
};

export type VerifyFetch = (
  input: string,
  init: { method: string; headers: { "content-type": string }; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type VerifySuccess = {
  success: true;
  nullifier: string;
  action: string;
};

export async function verifyIdkitResultUnchanged(args: {
  rpId: string;
  idkitResult: IdkitResultPayload;
  fetchImpl?: VerifyFetch;
}): Promise<VerifySuccess> {
  const rpId = args.rpId.trim();
  if (rpId === "") {
    throw new Error("WORLD_ID_RP_ID is required to verify a World ID proof.");
  }

  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const url = `${WORLD_ID_VERIFY_URL_BASE}/${encodeURIComponent(rpId)}`;
  const body = JSON.stringify(args.idkitResult);
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(
      `World ID verify failed for rp_id=${rpId}: HTTP ${String(response.status)} body=${responseText}`,
    );
  }

  const nullifier = extractProofOfHumanNullifier(args.idkitResult);
  return {
    success: true,
    nullifier,
    action: args.idkitResult.action,
  };
}

export function extractProofOfHumanNullifier(
  idkitResult: IdkitResultPayload,
): string {
  const matches = idkitResult.responses.filter(
    (item) => item.identifier === PROOF_OF_HUMAN_IDENTIFIER,
  );
  if (matches.length === 0) {
    throw new Error(
      `World ID stake gate requires credential identifier=${PROOF_OF_HUMAN_IDENTIFIER}. No matching response was present.`,
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `World ID stake gate expected exactly one ${PROOF_OF_HUMAN_IDENTIFIER} response. Got ${String(matches.length)}.`,
    );
  }
  const nullifier = matches[0]?.nullifier?.trim();
  if (nullifier === undefined || nullifier === "") {
    throw new Error(
      `World ID ${PROOF_OF_HUMAN_IDENTIFIER} response is missing nullifier.`,
    );
  }
  return nullifier;
}
