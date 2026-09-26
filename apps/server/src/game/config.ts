import { requiredEnv } from "@horror-tube/betting";

export type GameLoopConfig = {
  quorumVotes: number;
  voteCountdownSeconds: number;
  bettingCloseAfterVideoStartSeconds: number;
  videoTimeoutSeconds: number;
  settleSeconds: number;
};

function requiredPositiveInt(
  name: string,
  env: NodeJS.ProcessEnv,
): number {
  const raw = requiredEnv(name, env);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(
      `${name} must be an integer >= 1. Got: ${JSON.stringify(raw)}. See .env.example.`,
    );
  }
  return n;
}

export function readGameLoopConfig(
  env: NodeJS.ProcessEnv = process.env,
): GameLoopConfig {
  return {
    quorumVotes: requiredPositiveInt("QUORUM_VOTES", env),
    voteCountdownSeconds: requiredPositiveInt("VOTE_COUNTDOWN_SECONDS", env),
    bettingCloseAfterVideoStartSeconds: requiredPositiveInt(
      "BETTING_CLOSE_AFTER_VIDEO_START_SECONDS",
      env,
    ),
    videoTimeoutSeconds: requiredPositiveInt("VIDEO_TIMEOUT_SECONDS", env),
    settleSeconds: requiredPositiveInt("SETTLE_SECONDS", env),
  };
}

export function readRosterEnsLabels(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const raw = requiredEnv("ROSTER_ENS_LABELS", env);
  const labels = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (labels.length < 2) {
    throw new Error(
      `ROSTER_ENS_LABELS must list at least two ENS labels (comma-separated). Got ${String(labels.length)}. See .env.example.`,
    );
  }
  const sorted = [...labels].sort((a, b) => a.localeCompare(b));
  const unique = new Set(sorted);
  if (unique.size !== sorted.length) {
    throw new Error(
      `ROSTER_ENS_LABELS must not contain duplicate labels. See .env.example.`,
    );
  }
  return sorted;
}
