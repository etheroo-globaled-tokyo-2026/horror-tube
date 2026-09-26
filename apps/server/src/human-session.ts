import { createHmac, timingSafeEqual } from "node:crypto";

import * as v from "valibot";

import { HttpError } from "./http-error.js";

const NULLIFIER = /^0x[0-9a-fA-F]+$/u;

const SessionBody = v.object({
  nullifier: v.pipe(v.string(), v.regex(NULLIFIER)),
});

export function walletSecret(nullifier: string, pepper: string): string {
  return createHmac("sha256", pepper).update(nullifier).digest("hex");
}

export function issueSession(nullifier: string, pepper: string): string {
  const parsed = v.parse(SessionBody, { nullifier });
  const payload = Buffer.from(JSON.stringify(parsed), "utf8").toString("base64url");
  const sig = createHmac("sha256", pepper).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function readSession(token: string, pepper: string): string {
  const parts = token.split(".");
  const payload = parts[0];
  const sig = parts[1];
  if (payload === undefined || sig === undefined || parts.length !== 2 || payload === "" || sig === "") {
    throw new HttpError(401, "Session is not valid. Call POST /auth/world-id.");
  }
  const expected = createHmac("sha256", pepper).update(payload).digest("base64url");
  const given = Buffer.from(sig);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    throw new HttpError(401, "Session is not valid. Call POST /auth/world-id.");
  }
  let parsed;
  try {
    parsed = v.safeParse(
      SessionBody,
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch (err) {
    throw new HttpError(
      401,
      `Session is not valid. Call POST /auth/world-id. Underlying: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed.success) {
    throw new HttpError(401, "Session is not valid. Call POST /auth/world-id.");
  }
  return parsed.output.nullifier;
}
