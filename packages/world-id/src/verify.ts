import { hashSignal } from "@worldcoin/idkit-core/hashing";
import { z } from "zod";

import { worldIdEnvironmentSchema, type WorldIdEnvironment } from "./env.js";

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
  environment: worldIdEnvironmentSchema.optional(),
  responses: z.tuple([proofOfHumanResponseSchema], {
    error: `responses must hold exactly one ${PROOF_OF_HUMAN_IDENTIFIER} response`,
  }),
});

export type ProofOfHumanResult = z.output<typeof proofOfHumanResultSchema>;

const verifySuccessSchema = z.object({
  success: z.literal(true),
  action: z.string().optional(),
  nullifier: uint256Hex.optional(),
  environment: worldIdEnvironmentSchema,
  results: z.array(
    z.object({
      identifier: z.string(),
      success: z.boolean(),
      nullifier: uint256Hex.optional(),
    }),
  ),
});

const portalErrorSchema = z.object({
  code: z.string().optional(),
  detail: z.string().optional(),
  attribute: z.string().nullish(),
});

const CONFIG_ERROR_CODES = new Set(["environment_not_allowed", "app_not_migrated"]);
const CONFIG_ERROR_STATUSES = new Set([401, 403, 404]);

export type PortalFault = "misconfigured" | "unavailable" | "rejected";

export class WorldIdPortalError extends Error {
  readonly fault: PortalFault;
  readonly detail: string;
  constructor(fault: PortalFault, message: string, detail: string) {
    super(message);
    this.name = "WorldIdPortalError";
    this.fault = fault;
    this.detail = detail;
  }
}

function readPortalError(text: string): z.output<typeof portalErrorSchema> {
  try {
    const parsed = portalErrorSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function configFix(
  environment: WorldIdEnvironment,
  code: string | undefined,
  status: number,
): string {
  if (code === "app_not_migrated") {
    return "Migrate the Developer Portal app behind WORLD_ID_RP_ID to World ID 4.0.";
  }
  if (status === 404) {
    return "Set WORLD_ID_RP_ID to the rp_id of an active Developer Portal app.";
  }
  if (environment === "staging") {
    return "Renew WORLD_ID_STAGING_TOKEN: open a staging verification window in the Developer Portal and set its token, or set WORLD_ID_ENVIRONMENT to production or sandbox.";
  }
  return `Set WORLD_ID_ENVIRONMENT to an environment the Developer Portal app allows (now ${environment}).`;
}

function portalRejection(
  rpId: string,
  environment: WorldIdEnvironment,
  status: number,
  text: string,
): WorldIdPortalError {
  const failed = `World ID verify failed for rp_id=${rpId}: HTTP ${String(status)} body=${text}`;
  if (status >= 500) return new WorldIdPortalError("unavailable", failed, `HTTP ${String(status)}`);
  const portal = readPortalError(text);
  const detail = portal.detail ?? portal.code ?? `HTTP ${String(status)}`;
  const ours =
    CONFIG_ERROR_STATUSES.has(status) ||
    (portal.code !== undefined && CONFIG_ERROR_CODES.has(portal.code));
  if (!ours) return new WorldIdPortalError("rejected", failed, detail);
  return new WorldIdPortalError(
    "misconfigured",
    `${failed} This server's World ID configuration was refused, not the player's proof. ${configFix(environment, portal.code, status)}`,
    detail,
  );
}

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
    throw portalRejection(rpId, args.environment, response.status, text);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new WorldIdPortalError(
      "unavailable",
      `World ID verify returned non-JSON for rp_id=${rpId}: HTTP ${String(response.status)} (${reason}) body=${text}`,
      `HTTP ${String(response.status)} non-JSON`,
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
