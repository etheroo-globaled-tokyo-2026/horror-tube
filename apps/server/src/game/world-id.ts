/**
 * World ID proof verification for votes (docs/game-loop.md).
 * No verifier is wired in this package yet — refuse rather than accept unverified votes.
 */

export type WorldIdProofResult = {
  nullifier: string;
};

export type WorldIdVerifier = (
  proof: unknown,
) => Promise<WorldIdProofResult>;

export async function refuseUnverifiedWorldId(
  _proof: unknown,
): Promise<WorldIdProofResult> {
  throw new Error(
    "World ID verification is not available in @horror-tube/server. Refusing unverified votes. Wire a verifier before accepting votes.",
  );
}
