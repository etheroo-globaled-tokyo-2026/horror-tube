import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { z } from "zod";

import type { WorldIdEnvironment } from "./env.js";

export const WORLD_ID_VERIFY_URL_BASE = "https://developer.world.org/api/v4/verify";
export const PROOF_OF_HUMAN_IDENTIFIER = "proof_of_human";
export const PROOF_OF_HUMAN_ISSUER_SCHEMA_ID = 1;

export type VerifyFetch = (
  input: string,
  init: {
    method: "POST";
    headers: { "content-type": "application/json"; "x-staging-verification-token"?: string };
    body: string;
  },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export type IdkitResultJson = z.core.util.JSONType;

export type VerifiedHuman = {
  action: string;
  nullifier: string;
};

const uint256Hex = z
  .string()
  .regex(/^0x[0-9a-fA-F]{1,64}$/u, { error: "must be a 0x hex uint256" })
  .transform((value) => BigInt(value).toString(10));

const proofOfHumanResponseSchema = z.object({
  identifier: z.literal(PROOF_OF_HUMAN_IDENTIFIER, {
    error: `identifier must be ${PROOF_OF_HUMAN_IDENTIFIER}`,
  }),
  signal_hash: uint256Hex.optional(),
  proof: z.array(z.string()).length(5, { error: "proof must hold exactly 5 elements" }),
  nullifier: uint256Hex,
  issuer_schema_id: z.literal(PROOF_OF_HUMAN_ISSUER_SCHEMA_ID, {
    error: `issuer_schema_id must be ${String(PROOF_OF_HUMAN_ISSUER_SCHEMA_ID)} (Orb Proof of Human)`,
  }),
  expires_at_min: z.number().int(),
});

// WARNING: /api/v4/verify accepts legacy 3.0 and session proofs; this schema is what refuses them.
const proofOfHumanResultSchema = z.object({
  protocol_version: z.literal("4.0", {
    error: "legacy proofs are rejected; protocol_version must be 4.0",
  }),
  session_id: z
    .never({ error: "session proofs are rejected; a uniqueness proof is required" })
    .optional(),
  nonce: z.string().min(1),
  action: z.string().min(1),
  environment: z.enum(["production", "staging"]).optional(),
  responses: z.tuple([proofOfHumanResponseSchema], {
    error: `responses must hold exactly one ${PROOF_OF_HUMAN_IDENTIFIER} response`,
  }),
});

export type ProofOfHumanResult = z.output<typeof proofOfHumanResultSchema>;

const verifySuccessSchema = z.object({
  success: z.literal(true),
  action: z.string().optional(),
  nullifier: uint256Hex.optional(),
  environment: z.enum(["production", "staging", "sandbox"]),
  results: z.array(
    z.object({
      identifier: z.string(),
      success: z.boolean(),
      nullifier: uint256Hex.optional(),
    }),
  ),
});

export function parseProofOfHumanResult(input: IdkitResultJson): ProofOfHumanResult {
  const parsed = proofOfHumanResultSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`World ID result rejected:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export async function verifyProofOfHuman(args: {
  rpId: string;
  environment: WorldIdEnvironment;
  action: string;
  signal: string | null;
  idkitResult: IdkitResultJson;
  fetch: VerifyFetch;
  stagingToken?: string;
}): Promise<VerifiedHuman> {
  const rpId = args.rpId.trim();
  const stagingToken = args.stagingToken?.trim() ?? "";
  if (args.environment === "staging" && stagingToken === "") {
    throw new Error(
      "WORLD_ID_STAGING_TOKEN is required to verify a staging World ID proof. See .env.example.",
    );
  }
  if (rpId === "") {
    throw new Error("WORLD_ID_RP_ID is required to verify a World ID proof. See .env.example.");
  }
  const result = parseProofOfHumanResult(args.idkitResult);
  if (result.action !== args.action) {
    throw new Error(`World ID action mismatch. expected=${args.action} got=${result.action}`);
  }
  if (result.environment !== undefined && result.environment !== args.environment) {
    throw new Error(
      `World ID environment mismatch. expected=${args.environment} got=${result.environment}`,
    );
  }
  const [item] = result.responses;
  if (args.signal === null) {
    if (item.signal_hash !== undefined && item.signal_hash !== "0") {
      throw new Error("World ID proof carries a signal but the request had none.");
    }
  } else if (item.signal_hash !== BigInt(hashSignal(args.signal)).toString(10)) {
    throw new Error("World ID signal_hash does not match the expected signal.");
  }

  const url = `${WORLD_ID_VERIFY_URL_BASE}/${encodeURIComponent(rpId)}`;
  const response = await args.fetch(url, {
    method: "POST",
    headers:
      args.environment === "staging"
        ? { "content-type": "application/json", "x-staging-verification-token": stagingToken }
        : { "content-type": "application/json" },
    body: JSON.stringify(args.idkitResult),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `World ID verify failed for rp_id=${rpId}: HTTP ${String(response.status)} body=${text}`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `World ID verify returned non-JSON for rp_id=${rpId}: HTTP ${String(response.status)} body=${text}`,
      { cause: error },
    );
  }
  const verified = verifySuccessSchema.safeParse(json);
  if (!verified.success) {
    throw new Error(
      `World ID verify did not report success for rp_id=${rpId}: ${z.prettifyError(verified.error)} body=${text}`,
    );
  }
  const body = verified.data;
  if (body.environment !== args.environment) {
    throw new Error(
      `World ID verify environment mismatch. expected=${args.environment} got=${body.environment}`,
    );
  }
  if (body.action !== undefined && body.action !== args.action) {
    throw new Error(`World ID verify action mismatch. expected=${args.action} got=${body.action}`);
  }
  if (body.nullifier !== undefined && body.nullifier !== item.nullifier) {
    throw new Error("World ID verify returned a different nullifier than the proof.");
  }
  const passed = body.results.filter(
    (entry) => entry.identifier === PROOF_OF_HUMAN_IDENTIFIER && entry.success,
  );
  if (passed.length !== 1) {
    throw new Error(
      `World ID verify did not pass exactly one ${PROOF_OF_HUMAN_IDENTIFIER} result: body=${text}`,
    );
  }
  const passedNullifier = passed[0]?.nullifier;
  if (passedNullifier !== undefined && passedNullifier !== item.nullifier) {
    throw new Error("World ID verify result nullifier does not match the proof.");
  }

  return { action: result.action, nullifier: item.nullifier };
}
