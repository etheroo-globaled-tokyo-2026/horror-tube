import {
  createQueuedRecord,
  markBettingClosed,
  markPlaybackFinished,
  settleQueuedBattle,
  type BattleQueueInsert,
  type BattleQueueRecord,
  type BattleQueueStore,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";
import {
  nextRotationPair,
  type RandomInt,
} from "@horror-tube/fight/rotation";

import type { Phase, RoundState } from "../types.js";
import type { GameLoopConfig } from "./config.js";
import {
  refuseUnverifiedWorldId,
  type WorldIdVerifier,
} from "./world-id.js";

export type CharRuntime = {
  id: number;
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

export type GameLoopOptions = {
  config: GameLoopConfig;
  /** Sorted ENS labels; numeric RoundState ids are indexes into this list. */
  ensLabels: string[];
  ensStatuses: string[];
  now?: () => number;
  verifyWorldId?: WorldIdVerifier;
  /**
   * Challenger draw for stage 2+ (winner stays on). Tests inject a pinned source.
   * Defaults to a non-crypto sequential counter so production must pass cryptoRandomInt.
   */
  randomInt?: RandomInt;
  battleQueueStore: BattleQueueStore;
  chainWritePorts: ChainWritePorts;
  skipSettlement: boolean;
};

type Listener = (state: RoundState) => void;

function emptyVotes(ids: number[]): Record<number, number> {
  const votes: Record<number, number> = {};
  for (const id of ids) {
    votes[id] = 0;
  }
  return votes;
}

export function isAliveFromEnsStatus(ensLabel: string, status: string): boolean {
  if (status === "alive" || status === "") return true;
  if (status === "dead") return false;
  throw new Error(
    `${ensLabel} has unknown status ${JSON.stringify(status)}. Expected alive, dead, or "".`,
  );
}

function buildChars(ensLabels: string[], ensStatuses: string[]): CharRuntime[] {
  if (ensStatuses.length !== ensLabels.length) {
    throw new Error(
      `GameLoop ensStatuses length (${String(ensStatuses.length)}) must match ensLabels (${String(ensLabels.length)}).`,
    );
  }
  return ensLabels.map((ensLabel, id) => {
    const status = ensStatuses[id];
    if (status === undefined) {
      throw new Error(
        `GameLoop ensStatuses missing entry for label ${ensLabel} at index ${String(id)}.`,
      );
    }
    return {
      id,
      ensLabel,
      alive: isAliveFromEnsStatus(ensLabel, status),
      kills: 0,
      damage: 0,
    };
  });
}

export class GameLoop {
  readonly config: GameLoopConfig;
  readonly ensLabels: string[];
  private readonly initialAlive: boolean[];
  private readonly now: () => number;
  private readonly verifyWorldId: WorldIdVerifier;
  private readonly randomInt: RandomInt;
  private readonly battleQueueStore: BattleQueueStore;
  private readonly chainWritePorts: ChainWritePorts;
  private readonly skipSettlement: boolean;
  private readonly listeners = new Set<Listener>();

  private chars: CharRuntime[];
  private round = 1;
  private phase: Phase = "vote";
  private endsAt: number | null = null;
  private champion: number | null = null;
  private voters = 0;
  private votes: Record<number, number> = {};
  /** When each character's current vote_count was first reached (tie-break). */
  private reachedAt: Record<number, number> = {};
  private nullifiers = new Set<string>();
  private fighters: [number, number] | null = null;
  private pool: [number, number] = [0, 0];
  private winner: 0 | 1 | null = null;
  private videoUrl: string | null = null;
  /** Last-frame CDN URL for the next bout's image-to-video seed. */
  private frameUrl: string | null = null;
  private error: string | null = null;
  private betOpenedAt: number | null = null;
  private videoDurationMs: number | null = null;
  private outcome: { winner: 0 | 1; damage: number } | null = null;
  private settleDamage = 0;
  private queuedAgentResultId: string | null = null;
  private settleInFlight = false;
  /** Set when the bet phase ends, before the fight clock starts. */
  private bettingClosedGate = false;
  /** Set when the fight's video duration has elapsed. */
  private playbackFinishedGate = false;
  private holdingCopyApplied = false;

  constructor(options: GameLoopOptions) {
    if (options.ensLabels.length < 2) {
      throw new Error(
        `GameLoop requires at least two ENS labels. Got ${String(options.ensLabels.length)}.`,
      );
    }
    this.config = options.config;
    this.ensLabels = options.ensLabels;
    this.now = options.now ?? (() => Date.now());
    this.verifyWorldId = options.verifyWorldId ?? refuseUnverifiedWorldId;
    this.randomInt =
      options.randomInt ??
      ((maxExclusive: number) => {
        throw new Error(
          `GameLoop randomInt was not provided. Pass cryptoRandomInt (or a test double) for winner-stays pairing. maxExclusive=${String(maxExclusive)}.`,
        );
      });
    this.battleQueueStore = options.battleQueueStore;
    this.chainWritePorts = options.chainWritePorts;
    this.skipSettlement = options.skipSettlement;
    this.chars = buildChars(options.ensLabels, options.ensStatuses);
    this.initialAlive = this.chars.map((c) => c.alive);
    this.resetVoteTallies();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): RoundState {
    return {
      round: this.round,
      phase: this.phase,
      endsAt: this.endsAt,
      champion: this.champion,
      slots: this.slots(),
      voters: this.voters,
      quorum: this.config.quorumVotes,
      votes: { ...this.votes },
      fighters: this.fighters,
      pool: [...this.pool] as [number, number],
      winner: this.phase === "settle" || this.phase === "over" ? this.winner : null,
      videoUrl: this.videoUrl,
      frameUrl: this.frameUrl,
      error: this.error,
      chars: this.chars.map((c) => ({
        id: c.id,
        alive: c.alive,
        kills: c.kills,
        damage: c.damage,
      })),
    };
  }

  slots(): 1 | 2 {
    return this.champion === null ? 2 : 1;
  }

  /**
   * Advance timers. Call on an interval from the HTTP process.
   */
  async tick(now: number = this.now()): Promise<void> {
    if (this.settleInFlight) {
      return;
    }
    if (this.phase === "countdown" && this.endsAt !== null && now >= this.endsAt) {
      this.closeVoting(now);
      return;
    }
    if (this.phase === "bet") {
      this.maybeLeaveBet(now);
      return;
    }
    if (this.phase === "fight" && this.endsAt !== null && now >= this.endsAt) {
      this.settleInFlight = true;
      try {
        await this.enterSettle(now);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        console.error(`ENS settle failed: ${message}`);
        this.error = message;
        this.endsAt = null;
        this.emit();
        throw cause;
      } finally {
        this.settleInFlight = false;
      }
      return;
    }
    if (this.phase === "settle" && this.endsAt !== null && now >= this.endsAt) {
      this.afterSettle();
    }
  }

  /**
   * Unit-test path: verify a proof, then record the vote.
   * Production HTTP uses voteWithNullifier after readSession.
   */
  async vote(proof: unknown, picks: number[]): Promise<void> {
    const { nullifier } = await this.verifyWorldId(proof);
    this.voteWithNullifier(nullifier, picks);
  }

  /** Record one human's picks. Nullifier comes from the waiver session. */
  voteWithNullifier(nullifier: string, picks: number[]): void {
    if (this.phase !== "vote" && this.phase !== "countdown") {
      throw new Error(
        `vote is only allowed in vote or countdown phases. Current phase: ${this.phase}.`,
      );
    }
    const slots = this.slots();
    if (picks.length !== slots) {
      throw new Error(
        `picks.length must equal slots (${String(slots)}). Got ${String(picks.length)}.`,
      );
    }
    const unique = new Set(picks);
    if (unique.size !== picks.length) {
      throw new Error("picks must be unique character ids.");
    }
    for (const id of picks) {
      this.assertVotable(id);
    }
    if (nullifier.trim() === "") {
      throw new Error("World ID nullifier is empty.");
    }
    if (this.nullifiers.has(nullifier)) {
      throw new Error(
        `World ID nullifier already voted this round: ${nullifier}.`,
      );
    }
    this.nullifiers.add(nullifier);
    this.voters += 1;
    const now = this.now();
    for (const id of picks) {
      const next = (this.votes[id] ?? 0) + 1;
      this.votes[id] = next;
      this.reachedAt[id] = now;
    }
    if (
      this.phase === "vote" &&
      this.voters >= this.config.quorumVotes
    ) {
      this.phase = "countdown";
      this.endsAt = now + this.config.voteCountdownSeconds * 1000;
    }
    this.emit();
  }

  bet(side: 0 | 1, amount: number): void {
    if (this.phase !== "bet") {
      throw new Error(
        `bet is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (side !== 0 && side !== 1) {
      throw new Error(`bet side must be 0 or 1. Got: ${String(side)}.`);
    }
    if (!(amount > 0) || !Number.isFinite(amount)) {
      throw new Error(
        `bet amount must be a finite number > 0. Got: ${String(amount)}.`,
      );
    }
    this.pool[side] += amount;
    this.emit();
  }

  async attachAgentResult(insert: BattleQueueInsert): Promise<void> {
    if (this.phase !== "bet") {
      throw new Error(
        `attachAgentResult is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    const record = createQueuedRecord(insert);
    await this.battleQueueStore.save(record);
    this.queuedAgentResultId = record.id;
  }

  /**
   * Video job seam: record the CDN video URL, playback duration (ms), and the
   * last-frame CDN URL that seeds the next bout. Does not build a fal client.
   * Bet closes when this is set, outcome is set, and BET_MIN_SECONDS has passed.
   */
  setVideoReady(url: string, durationMs: number, frameUrl: string): void {
    if (this.phase !== "bet") {
      throw new Error(
        `setVideoReady is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (url.trim() === "") {
      throw new Error("setVideoReady url must be non-empty. Refusing placeholder.");
    }
    if (frameUrl.trim() === "") {
      throw new Error(
        "setVideoReady frameUrl must be non-empty. Refusing to continue without a next-fight seed frame.",
      );
    }
    if (!Number.isInteger(durationMs) || durationMs < 1) {
      throw new Error(
        `setVideoReady durationMs must be an integer >= 1. Got: ${String(durationMs)}.`,
      );
    }
    this.videoUrl = url.trim();
    this.frameUrl = frameUrl.trim();
    this.videoDurationMs = durationMs;
    this.maybeLeaveBet(this.now());
  }

  /**
   * Story/LLM seam: winner index into fighters and damage to the winner.
   */
  setOutcome(winner: 0 | 1, damage: number): void {
    if (this.phase !== "bet") {
      throw new Error(
        `setOutcome is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (winner !== 0 && winner !== 1) {
      throw new Error(`setOutcome winner must be 0 or 1. Got: ${String(winner)}.`);
    }
    if (!Number.isInteger(damage) || damage < 0) {
      throw new Error(
        `setOutcome damage must be an integer >= 0. Got: ${String(damage)}.`,
      );
    }
    this.outcome = { winner, damage };
    this.maybeLeaveBet(this.now());
  }

  /** Mark video job failed; refunds are recorded as pool cleared and error set. */
  failVideo(message: string): void {
    if (this.phase !== "bet") {
      throw new Error(
        `failVideo is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (message.trim() === "") {
      throw new Error("failVideo message must be non-empty.");
    }
    this.error = message.trim();
    this.pool = [0, 0];
    this.videoUrl = null;
    this.videoDurationMs = null;
    this.emit();
  }

  resetFromOver(): void {
    if (this.phase !== "over") {
      throw new Error(
        `resetFromOver is only allowed in over. Current phase: ${this.phase}.`,
      );
    }
    this.chars = this.ensLabels.map((ensLabel, id) => {
      const alive = this.initialAlive[id];
      if (alive === undefined) {
        throw new Error(
          `resetFromOver: missing initial alive flag for ${ensLabel} at index ${String(id)}.`,
        );
      }
      return {
        id,
        ensLabel,
        alive,
        kills: 0,
        damage: 0,
      };
    });
    this.champion = null;
    this.round = 1;
    this.videoUrl = null;
    this.frameUrl = null;
    this.error = null;
    this.winner = null;
    this.fighters = null;
    this.pool = [0, 0];
    this.outcome = null;
    this.videoDurationMs = null;
    this.betOpenedAt = null;
    this.queuedAgentResultId = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    this.enterVote();
  }

  private assertVotable(id: number): void {
    const char = this.chars[id];
    if (char === undefined) {
      throw new Error(`Unknown character id: ${String(id)}.`);
    }
    if (!char.alive) {
      throw new Error(`Character ${String(id)} is dead and cannot receive votes.`);
    }
    if (this.champion !== null && id === this.champion) {
      throw new Error(
        `Character ${String(id)} is the champion and is hidden from the vote list.`,
      );
    }
  }

  private resetVoteTallies(): void {
    const aliveIds = this.chars.filter((c) => c.alive).map((c) => c.id);
    this.votes = emptyVotes(aliveIds);
    this.reachedAt = {};
    this.nullifiers = new Set();
    this.voters = 0;
  }

  private closeVoting(now: number): void {
    // Stage 1 only: top two by votes. Stage 2+ pairs via enterBetFromRotation
    // after settle (no challenger ballot).
    if (this.champion !== null) {
      throw new Error(
        "closeVoting: stage 2+ must not collect a challenger ballot. Next bout starts from nextRotationPair after settle.",
      );
    }
    const ranked = this.rankCandidates();
    if (ranked.length < 2) {
      this.error = `Not enough votable characters to fill 2 slot(s).`;
      this.phase = "over";
      this.endsAt = null;
      this.emit();
      return;
    }
    this.fighters = [ranked[0]!, ranked[1]!];
    this.winner = null;
    this.outcome = null;
    this.videoUrl = null;
    this.videoDurationMs = null;
    this.error = null;
    this.pool = [0, 0];
    this.queuedAgentResultId = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    this.phase = "bet";
    this.betOpenedAt = now;
    this.endsAt = null;
    this.emit();
  }

  private rankCandidates(): number[] {
    const candidates = this.chars
      .filter((c) => c.alive && c.id !== this.champion)
      .map((c) => c.id);
    candidates.sort((a, b) => {
      const va = this.votes[a] ?? 0;
      const vb = this.votes[b] ?? 0;
      if (vb !== va) return vb - va;
      const ra = this.reachedAt[a] ?? Number.POSITIVE_INFINITY;
      const rb = this.reachedAt[b] ?? Number.POSITIVE_INFINITY;
      if (ra !== rb) return ra - rb;
      return a - b;
    });
    return candidates;
  }

  private maybeLeaveBet(now: number): void {
    if (this.phase !== "bet" || this.betOpenedAt === null) return;
    if (this.error !== null) return;
    if (this.videoUrl === null || this.videoDurationMs === null) {
      if (now - this.betOpenedAt >= this.config.videoTimeoutSeconds * 1000) {
        this.failVideo(
          `Video was not ready within VIDEO_TIMEOUT_SECONDS (${String(this.config.videoTimeoutSeconds)}). Bets refunded.`,
        );
      }
      return;
    }
    if (this.outcome === null) return;
    const minMs = this.config.betMinSeconds * 1000;
    if (now - this.betOpenedAt < minMs) {
      this.endsAt = this.betOpenedAt + minMs;
      this.emit();
      return;
    }
    this.winner = this.outcome.winner;
    this.settleDamage = this.outcome.damage;
    this.bettingClosedGate = true;
    this.phase = "fight";
    this.endsAt = now + this.videoDurationMs;
    this.emit();
  }

  /**
   * Re-run ENS settle after a failure. Does not apply the holding copy twice.
   */
  async retrySettle(): Promise<void> {
    if (this.error === null) {
      throw new Error(
        "retrySettle requires a failed settle. Current error is empty.",
      );
    }
    if (this.phase !== "fight" && this.phase !== "settle") {
      throw new Error(
        `retrySettle is only allowed after a failed settle. Current phase: ${this.phase}.`,
      );
    }
    this.error = null;
    await this.enterSettle(this.now());
  }

  private async enterSettle(now: number): Promise<void> {
    if (this.fighters === null || this.winner === null) {
      throw new Error("enterSettle requires fighters and winner.");
    }
    if (!this.bettingClosedGate) {
      throw new Error(
        "enterSettle: betting-closed signal is missing. It is set when the bet phase ends. Do not infer it from a timer.",
      );
    }
    this.playbackFinishedGate = true;
    if (this.queuedAgentResultId === null) {
      throw new Error(
        "enterSettle requires an attached agent result. Call attachAgentResult during the bet phase. Refusing to settle from setOutcome alone.",
      );
    }
    const winnerId = this.fighters[this.winner];
    const loserId = this.fighters[this.winner === 0 ? 1 : 0];
    const winnerChar = this.chars[winnerId];
    const loserChar = this.chars[loserId];
    if (winnerChar === undefined || loserChar === undefined) {
      throw new Error("enterSettle: fighter ids missing from chars.");
    }
    const winnerLabel = this.ensLabels[winnerId];
    const loserLabel = this.ensLabels[loserId];
    if (winnerLabel === undefined || loserLabel === undefined) {
      throw new Error("enterSettle: fighter ids missing from ensLabels.");
    }
    const queued = await this.battleQueueStore.get(this.queuedAgentResultId);
    if (queued === null) {
      throw new Error(
        `enterSettle: battle queue record ${JSON.stringify(this.queuedAgentResultId)} is missing from the store.`,
      );
    }
    if (
      queued.winnerSubname !== winnerLabel ||
      queued.loserSubname !== loserLabel
    ) {
      throw new Error(
        `enterSettle: agent result winner=${JSON.stringify(queued.winnerSubname)} loser=${JSON.stringify(queued.loserSubname)} does not match bout winner=${JSON.stringify(winnerLabel)} loser=${JSON.stringify(loserLabel)}.`,
      );
    }
    if (!this.holdingCopyApplied) {
      loserChar.alive = false;
      winnerChar.kills += 1;
      winnerChar.damage += this.settleDamage;
      this.champion = winnerId;
      this.holdingCopyApplied = true;
    }
    this.phase = "settle";
    this.endsAt = now + this.config.settleSeconds * 1000;
    this.emit();
    await this.writeQueuedEns(queued);
  }

  private async writeQueuedEns(queued: BattleQueueRecord): Promise<void> {
    const queueId = queued.id;
    let record = markPlaybackFinished(markBettingClosed(queued));
    await this.battleQueueStore.save(record);
    try {
      console.log(
        `ENS settle start queueId=${record.id} battleId=${record.battleId} skipSettlement=${String(this.skipSettlement)}`,
      );
      record = await settleQueuedBattle(
        record,
        this.chainWritePorts,
        this.battleQueueStore,
        { skipSettlement: this.skipSettlement },
      );
      this.error = null;
      console.log(
        `ENS settle done queueId=${record.id} injuriesTx=${record.injuriesTxHash} statusTx=${record.statusTxHash} settlementTx=${record.settlementTxHash}`,
      );
      this.emit();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`ENS settle failed queueId=${queueId}: ${message}`);
      this.error = message;
      this.endsAt = null;
      this.emit();
    }
  }

  private afterSettle(): void {
    if (this.error !== null) {
      return;
    }
    const alive = this.chars.filter((c) => c.alive);
    if (alive.length <= 1) {
      this.phase = "over";
      this.endsAt = null;
      this.emit();
      return;
    }
    this.round += 1;
    this.winner = null;
    this.pool = [0, 0];
    this.outcome = null;
    this.videoDurationMs = null;
    this.betOpenedAt = null;
    this.queuedAgentResultId = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    // Winner stays on: next challenger is random among living non-winners
    // (fightInputFromRotation / nextRotationPair). No challenger ballot.
    if (this.champion === null) {
      throw new Error(
        "afterSettle: champion is required before starting the next bout via rotation.",
      );
    }
    this.enterBetFromRotation(this.champion, this.now());
  }

  /**
   * Stage 2+ bout start: champion vs random living non-winner.
   * Consumes nextRotationPair so narration cannot name a different opponent.
   */
  private enterBetFromRotation(championId: number, now: number): void {
    const championLabel = this.ensLabels[championId];
    if (championLabel === undefined) {
      throw new Error(
        `enterBetFromRotation: champion id ${String(championId)} has no ENS label.`,
      );
    }
    const roster = this.chars.map((c) => {
      const subname = this.ensLabels[c.id];
      if (subname === undefined) {
        throw new Error(
          `enterBetFromRotation: character id ${String(c.id)} has no ENS label.`,
        );
      }
      return {
        subname,
        status: (c.alive ? "alive" : "dead") as "alive" | "dead",
      };
    });
    const pair = nextRotationPair(roster, championLabel, this.randomInt);
    const challengerId = this.ensLabels.indexOf(pair.challengerSubname);
    if (challengerId < 0) {
      throw new Error(
        `enterBetFromRotation: challenger ${JSON.stringify(pair.challengerSubname)} missing from ensLabels.`,
      );
    }
    this.fighters = [championId, challengerId];
    this.videoUrl = null;
    this.error = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    this.phase = "bet";
    this.betOpenedAt = now;
    this.endsAt = null;
    this.emit();
  }

  private enterVote(): void {
    this.phase = "vote";
    this.endsAt = null;
    this.resetVoteTallies();
    this.emit();
  }

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
