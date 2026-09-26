import * as v from "valibot";

import { HttpError } from "./http-error.js";

const NULLIFIER = /^0x[0-9a-fA-F]+$/u;

const HumanCredential = v.picklist(["proof_of_human", "orb"]);

const ResultRow = v.object({
  identifier: v.string(),
  success: v.boolean(),
  nullifier: v.optional(v.string()),
  detail: v.optional(v.string()),
});

const WorldVerifyBody = v.object({
  success: v.boolean(),
  action: v.optional(v.string()),
  environment: v.optional(v.string()),
  nullifier: v.optional(v.string()),
  message: v.optional(v.string()),
  session_id: v.optional(v.string()),
  results: v.optional(v.array(ResultRow)),
});

function nullifierOrThrow(value: string | undefined): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (!NULLIFIER.test(value)) {
    throw new HttpError(401, "World verify nullifier was not 0x-prefixed hex.");
  }
  return value;
}

export function nullifierFromWorldBody(
  status: number,
  body: string,
  walletAction: string,
  environment: string,
): string {
  if (status !== 200) {
    throw new HttpError(
      502,
      `World verify failed with HTTP ${String(status)}. Body: ${body.slice(0, 500)}`,
    );
  }
  let parsed;
  try {
    parsed = v.safeParse(WorldVerifyBody, JSON.parse(body));
  } catch (err) {
    throw new HttpError(
      502,
      `World verify response was not JSON. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed.success) {
    throw new HttpError(
      502,
      `World verify response was not a proof result. Underlying: ${parsed.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const proof = parsed.output;
  if (!proof.success) {
    const detail = proof.message ?? proof.results?.find((row) => row.detail !== undefined)?.detail;
    throw new HttpError(401, detail ?? "World verify rejected the proof.");
  }
  if (proof.action !== undefined && proof.action !== walletAction) {
    throw new HttpError(
      401,
      `World ID action mismatch. expected=${walletAction} got=${proof.action}`,
    );
  }
  if (proof.environment !== undefined && proof.environment !== environment) {
    throw new HttpError(
      401,
      `World ID environment mismatch. expected=${environment} got=${proof.environment}`,
    );
  }
  const human = (proof.results ?? []).filter(
    (row) => row.success && v.safeParse(HumanCredential, row.identifier).success,
  );
  if (human.length === 0) {
    throw new HttpError(401, "World verify did not include a successful proof_of_human credential.");
  }
  const top = nullifierOrThrow(proof.nullifier);
  const fromResult = nullifierOrThrow(human.find((row) => row.nullifier !== undefined)?.nullifier);
  if (top !== undefined && fromResult !== undefined && top !== fromResult) {
    throw new HttpError(401, "World verify nullifier did not match the proof_of_human result.");
  }
  const nullifier = top ?? fromResult;
  if (nullifier === undefined) {
    const sessionNote =
      proof.session_id === undefined
        ? ""
        : " The response included session_id. This server keys the wallet on the nullifier.";
    throw new HttpError(401, `World verify response had no nullifier.${sessionNote}`);
  }
  return nullifier;
}

const ProofRequest = v.object({
  action: v.string(),
  environment: v.optional(v.string()),
});

export async function verifyWorldIdProof(
  rawBody: string,
  rpId: string,
  worldApiUrl: string,
  walletAction: string,
  environment: string,
  fetchImpl: typeof fetch,
): Promise<string> {
  let request;
  try {
    request = v.safeParse(ProofRequest, JSON.parse(rawBody));
  } catch (err) {
    throw new HttpError(
      400,
      `Request body is not JSON. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!request.success) throw new HttpError(400, "World ID proof must include action.");
  if (request.output.action !== walletAction) {
    throw new HttpError(
      401,
      `World ID action mismatch. expected=${walletAction} got=${request.output.action}`,
    );
  }
  if (request.output.environment !== undefined && request.output.environment !== environment) {
    throw new HttpError(
      401,
      `World ID environment mismatch. expected=${environment} got=${request.output.environment}`,
    );
  }
  const origin = worldApiUrl.replace(/\/$/u, "");
  const url = `${origin}/api/v4/verify/${encodeURIComponent(rpId)}`;
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: rawBody,
    });
  } catch (err) {
    throw new HttpError(
      502,
      `World verify request failed. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const body = await response.text();
  return nullifierFromWorldBody(response.status, body, walletAction, environment);
}
