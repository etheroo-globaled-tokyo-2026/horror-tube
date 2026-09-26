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
  type RosterEntry,
} from "@horror-tube/fight/rotation";

import { normalizeSuiAddress } from "@mysten/sui/utils";
import { randomUUID } from "node:crypto";

import type { BattleBettingPorts } from "../battle-betting.js";
import type { FightJobRunner } from "../fight-job.js";
import { DuplicateVoteError, type RoundStore } from "../db/rounds.js";
import type { Phase, RoundState } from "../types.js";
import type { GameLoopConfig } from "./config.js";

export type CharRuntime = {
  id: number;
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

export type GameLoopOptions = {
  config: GameLoopConfig;
  ensLabels: string[];
  ensStatuses: string[];
  now?: () => number;
  randomInt?: RandomInt;
  battleQueueStore: BattleQueueStore;
  roundStore: RoundStore;
  chainWritePorts: ChainWritePorts;
  battleBetting: BattleBettingPorts;
  fightJob: FightJobRunner;
};

type Listener = (state: RoundState) => void;
type Tally = NonNullable<RoundState["tally"]>;
type ChainRetry = { retryAt: number; delayMs: number };

const CHAIN_RETRY_FIRST_MS = 5_000;
const CHAIN_RETRY_MAX_MS = 60_000;

function nextChainRetry(now: number, previous: ChainRetry | null): ChainRetry {
  const delayMs =
    previous === null ? CHAIN_RETRY_FIRST_MS : Math.min(previous.delayMs * 2, CHAIN_RETRY_MAX_MS);
  return { retryAt: now + delayMs, delayMs };
}

export class StoreWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "StoreWriteError";
  }
}

function rankTally(rows: Tally): Tally {
  return [...rows].sort((a, b) => b.votes - a.votes || a.reachedAt - b.reachedAt || a.id - b.id);
}

function emptyVotes(ids: number[]): Record<number, number> {
  return Object.fromEntries(ids.map((id) => [id, 0] as const));
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
  private readonly randomInt: RandomInt;
  private readonly battleQueueStore: BattleQueueStore;
  private readonly roundStore: RoundStore;
  private readonly chainWritePorts: ChainWritePorts;
  private readonly battleBetting: BattleBettingPorts;
  private readonly fightJob: FightJobRunner;
  private readonly listeners = new Set<Listener>();
  private readonly pendingCancels = new Map<string, ChainRetry>();
  private cancelRetryInFlight = false;

  private chars: CharRuntime[];
  private round = 1;
  private phase: Phase = "vote";
  private endsAt: number | null = null;
  private champion: number | null = null;
  private voters = 0;
  private votes: Record<number, number> = {};
  private seasonId: string | null = null;
  private roundId: string | null = null;
  private roundRowWrite: Promise<string> | null = null;
  private votingClosed = false;
  private readonly pendingVotes = new Set<Promise<void>>();
  private tally: Tally | null = null;
  private fighters: [number, number] | null = null;
  private pool: [number, number] = [0, 0];
  private onChainBattleId: string | null = null;
  private poolObjectId: string | null = null;
  private winner: 0 | 1 | null = null;
  private videoUrl: string | null = null;
  private frameUrl: string | null = null;
  private error: string | null = null;
  private betOpenedAt: number | null = null;
  private videoStartedAt: number | null = null;
  private bettingClosesAt: number | null = null;
  private playbackStartWrite: Promise<void> | null = null;
  private closeBettingInFlight = false;
  private lastCloseBettingAt = 0;
  private videoDurationMs: number | null = null;
  private outcome: { winner: 0 | 1; damage: number } | null = null;
  private settleDamage = 0;
  private queuedAgentResultId: string | null = null;
  private settleInFlight = false;
  private openRetry: ChainRetry | null = null;
  private openInFlight = false;
  private bettingClosedGate = false;
  private playbackFinishedGate = false;
  private holdingCopyApplied = false;
  private lastPoolReadAt = 0;
  private poolReadInFlight = false;
  private static readonly POOL_READ_INTERVAL_MS = 2000;

  constructor(options: GameLoopOptions) {
    if (options.ensLabels.length < 2) {
      throw new Error(
        `GameLoop requires at least two ENS labels. Got ${String(options.ensLabels.length)}.`,
      );
    }
    this.config = options.config;
    this.ensLabels = options.ensLabels;
    this.now = options.now ?? (() => Date.now());
    this.randomInt =
      options.randomInt ??
      ((maxExclusive: number) => {
        throw new Error(
          `GameLoop randomInt was not provided. Pass cryptoRandomInt (or a test double) for winner-stays pairing. maxExclusive=${String(maxExclusive)}.`,
        );
      });
    this.battleQueueStore = options.battleQueueStore;
    this.roundStore = options.roundStore;
    this.chainWritePorts = options.chainWritePorts;
    this.battleBetting = options.battleBetting;
    this.fightJob = options.fightJob;
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
      tally: this.tally === null ? null : this.tally.map((t) => ({ ...t })),
      fighters: this.fighters,
      battleId: this.onChainBattleId,
      poolId: this.poolObjectId,
      pool: [this.pool[0], this.pool[1]],
      winner: this.phase === "settle" || this.phase === "over" ? this.winner : null,
      videoUrl: this.videoUrl,
      videoStartedAt: this.videoStartedAt,
      bettingClosesAt: this.bettingClosesAt,
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

  async tick(now: number = this.now()): Promise<void> {
    await this.retryPendingCancels(now);
    if (this.settleInFlight) {
      return;
    }
    if (this.phase === "countdown" && this.endsAt !== null && now >= this.endsAt) {
      await this.closeVoting(now);
      return;
    }
    if (this.phase === "bet") {
      await this.maybeOpenPool(now);
      await this.maybeRefreshPool(now);
      await this.maybeLeaveBet(now);
      return;
    }
    if (this.phase === "fight" && this.endsAt !== null && now >= this.endsAt) {
      await this.runSettle(now);
      return;
    }
    if (this.phase === "settle" && this.endsAt !== null && now >= this.endsAt) {
      await this.afterSettle();
    }
  }

  async voteWithNullifier(nullifier: string, picks: number[]): Promise<void> {
    this.assertBeforeCutoff("vote", this.now());
    if (this.phase !== "vote" && this.phase !== "countdown") {
      throw new Error(
        `vote is only allowed in vote or countdown phases. Current phase: ${this.phase}.`,
      );
    }
    if (this.votingClosed) {
      throw new Error(`vote rejected: voting for round ${String(this.round)} is closed.`);
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
    const labels = picks.map((id) => this.labelOf(id));
    const stored = this.storeVote(nullifier, labels);
    this.pendingVotes.add(stored);
    try {
      await stored;
    } finally {
      this.pendingVotes.delete(stored);
    }
    this.voters += 1;
    const now = this.now();
    for (const id of picks) {
      this.votes[id] = (this.votes[id] ?? 0) + 1;
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

  private async storeVote(nullifier: string, picks: string[]): Promise<void> {
    const round = this.round;
    let roundId: string | null = null;
    try {
      roundId = await this.ensureRoundRow();
      await this.roundStore.insertVote({ roundId, nullifier, picks, at: this.now() });
    } catch (cause) {
      if (cause instanceof DuplicateVoteError) throw cause;
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new StoreWriteError(
        `Vote insert failed for round ${String(round)} (rounds.id=${String(roundId)}): ${detail}. The vote was not counted.`,
        { cause },
      );
    }
  }

  private ensureRoundRow(): Promise<string> {
    if (this.roundId !== null) return Promise.resolve(this.roundId);
    this.roundRowWrite ??= this.createRoundRow().finally(() => {
      this.roundRowWrite = null;
    });
    return this.roundRowWrite;
  }

  private async createRoundRow(): Promise<string> {
    const round = this.round;
    this.seasonId ??= await this.roundStore.startSeason(
      this.chars.map((c) => ({
        ensLabel: this.labelOf(c.id),
        alive: c.alive,
        kills: c.kills,
        damage: c.damage,
      })),
    );
    const id = await this.roundStore.startRound({
      seasonId: this.seasonId,
      roundNumber: round,
      slots: this.slots(),
      quorum: this.config.quorumVotes,
      championLabel: this.champion === null ? null : this.labelOf(this.champion),
    });
    if (this.round === round) this.roundId = id;
    return id;
  }

  private labelOf(id: number): string {
    const label = this.ensLabels[id];
    if (label === undefined) {
      throw new Error(`Character id ${String(id)} has no ENS label.`);
    }
    return label;
  }

  assertBetAllowed(poolId: string): void {
    this.assertBeforeCutoff("bet", this.now());
    if (this.phase !== "bet") {
      throw new Error(
        `bet rejected: betting is only open in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (
      this.poolObjectId === null ||
      normalizeSuiAddress(poolId) !== normalizeSuiAddress(this.poolObjectId)
    ) {
      throw new Error(
        `bet rejected: pool ${poolId} is not the live pool ${String(this.poolObjectId)} (battleId=${String(this.onChainBattleId)}).`,
      );
    }
  }

  async reportPlaybackStart(battleId: string): Promise<void> {
    if (this.phase !== "bet") {
      throw new Error(
        `playback start is only accepted in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (battleId !== this.onChainBattleId) {
      throw new Error(
        `playback start battleId ${JSON.stringify(battleId)} does not match live battle ${JSON.stringify(this.onChainBattleId)}.`,
      );
    }
    if (this.videoUrl === null) {
      throw new Error(
        `playback start refused for battle ${battleId}: the fight video is not ready.`,
      );
    }
    if (this.videoStartedAt !== null) return;
    if (this.playbackStartWrite === null) {
      this.playbackStartWrite = this.storePlaybackStart(battleId, this.now()).finally(() => {
        this.playbackStartWrite = null;
      });
    }
    await this.playbackStartWrite;
  }

  private async storePlaybackStart(battleId: string, startedAt: number): Promise<void> {
    const queueId = this.queuedAgentResultId;
    if (queueId === null) {
      throw new Error(
        `playback start for battle ${battleId}: no battle_results row is attached. Betting stays open.`,
      );
    }
    const closesAt = startedAt + this.config.bettingCloseAfterVideoStartSeconds * 1000;
    try {
      const record = await this.battleQueueStore.get(queueId);
      if (record === null) {
        throw new Error(`battle_results row ${queueId} is missing`);
      }
      await this.battleQueueStore.save({
        ...record,
        videoStartedAt: startedAt,
        bettingClosesAt: closesAt,
      });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new StoreWriteError(
        `Storing betting_closes_at failed for battle ${battleId} (battle_results ${queueId}): ${detail}. Betting stays open.`,
        { cause },
      );
    }
    if (!this.isSameBetBout(battleId)) return;
    this.videoStartedAt = startedAt;
    this.bettingClosesAt = closesAt;
    console.log(
      `playback started battleId=${battleId} video_started_at=${new Date(startedAt).toISOString()} betting_closes_at=${new Date(closesAt).toISOString()}`,
    );
    this.emit();
  }

  private assertBeforeCutoff(action: "vote" | "bet", now: number): void {
    if (this.bettingClosesAt !== null && now >= this.bettingClosesAt) {
      throw new Error(
        `${action} rejected: betting closed at ${new Date(this.bettingClosesAt).toISOString()} (betting_closes_at, battleId=${String(this.onChainBattleId)}).`,
      );
    }
  }

  private clearPlaybackCutoff(): void {
    this.videoStartedAt = null;
    this.bettingClosesAt = null;
    this.lastCloseBettingAt = 0;
  }

  setPool(
    battleId: string,
    poolId: string,
    totals: [number, number],
  ): void {
    if (this.onChainBattleId !== battleId) {
      throw new Error(
        `setPool battleId ${JSON.stringify(battleId)} does not match live battle ${JSON.stringify(this.onChainBattleId)}.`,
      );
    }
    this.poolObjectId = poolId;
    this.pool = [totals[0], totals[1]];
    this.emit();
  }

  private async maybeRefreshPool(now: number): Promise<void> {
    if (this.onChainBattleId === null || this.poolObjectId === null) {
      return;
    }
    if (this.poolReadInFlight) {
      return;
    }
    if (
      this.lastPoolReadAt !== 0 &&
      now - this.lastPoolReadAt < GameLoop.POOL_READ_INTERVAL_MS
    ) {
      return;
    }
    this.poolReadInFlight = true;
    this.lastPoolReadAt = now;
    const battleId = this.onChainBattleId;
    const poolId = this.poolObjectId;
    try {
      const totals = await this.battleBetting.readPoolTotals(battleId);
      if (this.onChainBattleId !== battleId || this.poolObjectId !== poolId) {
        return;
      }
      const next: [number, number] = [Number(totals[0]), Number(totals[1])];
      if (this.pool[0] === next[0] && this.pool[1] === next[1]) {
        return;
      }
      this.setPool(battleId, poolId, next);
    } catch (cause: unknown) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(
        `Sui pool totals read failed (battleId=${battleId}): ${detail}`,
      );
    } finally {
      this.poolReadInFlight = false;
    }
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
    this.emit();
  }

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
  }

  async failVideo(message: string): Promise<void> {
    if (this.phase !== "bet") {
      throw new Error(
        `failVideo is only allowed in the bet phase. Current phase: ${this.phase}.`,
      );
    }
    if (message.trim() === "") {
      throw new Error("failVideo message must be non-empty.");
    }
    const battleId = this.onChainBattleId;
    this.error = message.trim();
    this.pool = [0, 0];
    this.videoUrl = null;
    this.videoDurationMs = null;
    this.onChainBattleId = null;
    this.poolObjectId = null;
    this.betOpenedAt = null;
    this.clearPlaybackCutoff();
    this.endsAt = null;
    this.phase = "over";
    this.emit();
    if (battleId !== null) {
      await this.cancelPool(battleId, this.now());
    }
  }

  private async cancelPool(battleId: string, now: number): Promise<void> {
    try {
      await this.battleBetting.cancelBattle(battleId);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      const retry = nextChainRetry(now, this.pendingCancels.get(battleId) ?? null);
      this.pendingCancels.set(battleId, retry);
      console.error(
        `Sui betting cancelBattle failed (battleId=${battleId}): ${detail}. Stakes stay locked until it lands; retrying in ${String(retry.delayMs)} ms.`,
      );
      return;
    }
    this.pendingCancels.delete(battleId);
    console.log(`Sui betting cancelBattle battleId=${battleId}`);
  }

  private async retryPendingCancels(now: number): Promise<void> {
    if (this.cancelRetryInFlight) return;
    const due = [...this.pendingCancels]
      .filter(([, retry]) => now >= retry.retryAt)
      .map(([battleId]) => battleId);
    if (due.length === 0) return;
    this.cancelRetryInFlight = true;
    try {
      for (const battleId of due) {
        await this.cancelPool(battleId, now);
      }
    } finally {
      this.cancelRetryInFlight = false;
    }
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
    this.seasonId = null;
    this.videoUrl = null;
    this.frameUrl = null;
    this.error = null;
    this.winner = null;
    this.fighters = null;
    this.pool = [0, 0];
    this.outcome = null;
    this.videoDurationMs = null;
    this.betOpenedAt = null;
    this.clearPlaybackCutoff();
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
    this.voters = 0;
    this.roundId = null;
    this.votingClosed = false;
    this.tally = null;
  }

  private async closeVoting(now: number): Promise<void> {
    if (this.champion !== null) {
      throw new Error(
        "closeVoting: stage 2+ must not collect a challenger ballot. Next bout starts from nextRotationPair after settle.",
      );
    }
    this.votingClosed = true;
    this.endsAt = null;
    await Promise.allSettled(this.pendingVotes);
    const roundId = this.roundId;
    try {
      if (roundId === null) throw new Error("no rounds row was stored for this round");
      this.tally = rankTally(
        (await this.roundStore.storeTally(roundId)).map((row) => ({
          id: this.idOf(row.ensLabel),
          votes: row.voteCount,
          reachedAt: row.reachedAt,
        })),
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.error = `Tally insert failed for round ${String(this.round)} (rounds.id=${String(roundId)}): ${detail}. Betting stays closed.`;
      console.error(this.error);
      this.phase = "over";
      this.emit();
      return;
    }
    console.log(
      `tally stored round=${String(this.round)} rounds.id=${roundId} ${this.tally.map((t) => `${this.labelOf(t.id)}=${String(t.votes)}`).join(",")}`,
    );
    this.emit();
    const ranked = this.tally.map((t) => t.id);
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
    this.onChainBattleId = randomUUID();
    this.poolObjectId = null;
    this.openRetry = null;
    this.queuedAgentResultId = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    this.phase = "bet";
    this.betOpenedAt = now;
    this.clearPlaybackCutoff();
    this.endsAt = null;
    this.emit();
    this.kickFightJob();
    await this.maybeOpenPool(now);
  }

  private idOf(ensLabel: string): number {
    const id = this.ensLabels.indexOf(ensLabel);
    if (id < 0) {
      throw new Error(`Stored tally names ${JSON.stringify(ensLabel)}, which is not in ROSTER_ENS_LABELS.`);
    }
    return id;
  }

  private async maybeLeaveBet(now: number): Promise<void> {
    if (this.phase !== "bet" || this.betOpenedAt === null) return;
    if (this.videoUrl === null || this.videoDurationMs === null) {
      if (now - this.betOpenedAt >= this.config.videoTimeoutSeconds * 1000) {
        await this.failVideo(
          `Video was not ready within VIDEO_TIMEOUT_SECONDS (${String(this.config.videoTimeoutSeconds)}). Bets refunded.`,
        );
      }
      return;
    }
    const startedAt = this.videoStartedAt;
    const closesAt = this.bettingClosesAt;
    if (startedAt === null || closesAt === null || now < closesAt) return;
    if (this.outcome === null) {
      throw new Error(
        `betting_closes_at passed for battle ${String(this.onChainBattleId)} but no outcome is set. Refusing to start the fight.`,
      );
    }
    const battleId = this.onChainBattleId;
    if (battleId === null) {
      throw new Error("betting_closes_at passed but the bet phase has no battle id.");
    }
    if (this.poolObjectId === null || this.closeBettingInFlight) return;
    if (
      this.lastCloseBettingAt !== 0 &&
      now - this.lastCloseBettingAt < GameLoop.POOL_READ_INTERVAL_MS
    ) {
      return;
    }
    this.closeBettingInFlight = true;
    this.lastCloseBettingAt = now;
    try {
      await this.battleBetting.closeBetting(battleId);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      this.error = `Sui closeBetting failed at betting_closes_at ${new Date(closesAt).toISOString()} (battleId=${battleId}): ${detail}. New bets stay rejected; bettingClosed is not set. Retrying.`;
      console.error(this.error);
      this.emit();
      return;
    } finally {
      this.closeBettingInFlight = false;
    }
    if (!this.isSameBetBout(battleId)) return;
    console.log(`Sui betting closeBetting battleId=${battleId}`);
    this.error = null;
    this.winner = this.outcome.winner;
    this.settleDamage = this.outcome.damage;
    this.bettingClosedGate = true;
    this.phase = "fight";
    this.endsAt = startedAt + this.videoDurationMs;
    this.emit();
  }

  async retrySettle(): Promise<void> {
    if (this.settleInFlight) {
      throw new Error(
        `retrySettle refused: a settle is already running for round ${String(this.round)}.`,
      );
    }
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
    await this.runSettle(this.now());
  }

  private async runSettle(now: number): Promise<void> {
    this.settleInFlight = true;
    try {
      await this.enterSettle(now);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`ENS settle failed (round ${String(this.round)}): ${message}`);
      this.error = message;
      this.endsAt = null;
      this.emit();
      throw cause;
    } finally {
      this.settleInFlight = false;
    }
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
        `ENS settle start queueId=${record.id} battleId=${record.battleId}`,
      );
      record = await settleQueuedBattle(
        record,
        this.chainWritePorts,
        this.battleQueueStore,
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

  private async afterSettle(): Promise<void> {
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
    this.tally = null;
    this.winner = null;
    this.pool = [0, 0];
    this.onChainBattleId = null;
    this.poolObjectId = null;
    this.outcome = null;
    this.videoDurationMs = null;
    this.betOpenedAt = null;
    this.clearPlaybackCutoff();
    this.queuedAgentResultId = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    if (this.champion === null) {
      throw new Error(
        "afterSettle: champion is required before starting the next bout via rotation.",
      );
    }
    await this.enterBetFromRotation(this.champion, this.now());
  }

  private async enterBetFromRotation(
    championId: number,
    now: number,
  ): Promise<void> {
    const championLabel = this.ensLabels[championId];
    if (championLabel === undefined) {
      throw new Error(
        `enterBetFromRotation: champion id ${String(championId)} has no ENS label.`,
      );
    }
    const roster = this.chars.map((c): RosterEntry => {
      const subname = this.ensLabels[c.id];
      if (subname === undefined) {
        throw new Error(
          `enterBetFromRotation: character id ${String(c.id)} has no ENS label.`,
        );
      }
      return {
        subname,
        status: c.alive ? "alive" : "dead",
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
    this.onChainBattleId = randomUUID();
    this.poolObjectId = null;
    this.openRetry = null;
    this.bettingClosedGate = false;
    this.playbackFinishedGate = false;
    this.holdingCopyApplied = false;
    this.phase = "bet";
    this.betOpenedAt = now;
    this.clearPlaybackCutoff();
    this.endsAt = null;
    this.emit();
    this.kickFightJob();
    await this.maybeOpenPool(now);
  }

  private async maybeOpenPool(now: number): Promise<void> {
    const battleId = this.onChainBattleId;
    if (this.phase !== "bet" || this.error !== null || battleId === null) return;
    if (this.poolObjectId !== null || this.openInFlight) return;
    if (this.openRetry !== null && now < this.openRetry.retryAt) return;
    const latestCloseUnix = BigInt(
      Math.floor(now / 1000) +
        this.config.videoTimeoutSeconds +
        this.config.bettingCloseAfterVideoStartSeconds +
        120,
    );
    this.openInFlight = true;
    try {
      await this.battleBetting.openBattle(battleId, latestCloseUnix);
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (!this.isSameBetBout(battleId)) {
        console.error(
          `Sui betting openPool failed after its bout ended (battleId=${battleId}): ${detail}`,
        );
        return;
      }
      this.openRetry = nextChainRetry(now, this.openRetry);
      console.error(
        `Sui betting openPool failed (battleId=${battleId}): ${detail}. Bets stay refused until it lands; retrying in ${String(this.openRetry.delayMs)} ms.`,
      );
      return;
    } finally {
      this.openInFlight = false;
    }
    if (!this.isSameBetBout(battleId)) return;
    this.poolObjectId = this.battleBetting.poolIdFor(battleId);
    this.openRetry = null;
    this.lastPoolReadAt = 0;
    console.log(
      `Sui betting openPool battleId=${battleId} poolId=${this.poolObjectId} closesAt=${String(latestCloseUnix)}`,
    );
    this.emit();
  }

  private kickFightJob(): void {
    void this.runFightJob().catch((cause: unknown) => {
      const detail = cause instanceof Error ? cause.message : String(cause);
      console.error(`fight job failed unexpectedly: ${detail}`);
    });
  }

  private isSameBetBout(onChainBattleId: string): boolean {
    return this.phase === "bet" && this.onChainBattleId === onChainBattleId;
  }

  private async runFightJob(): Promise<void> {
    if (this.phase !== "bet") {
      return;
    }
    if (this.fighters === null || this.onChainBattleId === null) {
      await this.failVideo(
        "Fight job cannot start: fighters or on-chain battle id missing after bet open.",
      );
      return;
    }
    const fighterA = this.ensLabels[this.fighters[0]];
    const fighterB = this.ensLabels[this.fighters[1]];
    if (fighterA === undefined || fighterB === undefined) {
      await this.failVideo(
        `Fight job cannot start: missing ENS labels for fighters ${JSON.stringify(this.fighters)}.`,
      );
      return;
    }
    const livingSubnames = this.chars
      .filter((c) => c.alive)
      .map((c) => {
        const label = this.ensLabels[c.id];
        if (label === undefined) {
          throw new Error(
            `Fight job: character id ${String(c.id)} has no ENS label.`,
          );
        }
        return label;
      });
    const onChainBattleId = this.onChainBattleId;
    const battleId = onChainBattleId;
    const priorFrameUrl = this.frameUrl;
    console.log(
      `fight job start round=${String(this.round)} battleId=${battleId} fighters=${fighterA},${fighterB} priorFrame=${priorFrameUrl === null ? "none" : "set"}`,
    );
    try {
      const result = await this.fightJob({
        battleId,
        fighterASubname: fighterA,
        fighterBSubname: fighterB,
        livingSubnames,
        priorFrameUrl,
        round: this.round,
      });
      if (!this.isSameBetBout(onChainBattleId)) {
        console.log(
          `fight job battleId=${battleId} finished after its bout ended (phase=${this.phase} currentBattleId=${String(this.onChainBattleId)}); ignoring result.`,
        );
        return;
      }
      await this.attachAgentResult(result.insert);
      if (!this.isSameBetBout(onChainBattleId)) {
        console.log(
          `fight job battleId=${battleId} bout ended while saving the agent result (phase=${this.phase}); ignoring result.`,
        );
        return;
      }
      this.setOutcome(result.winnerSide, result.damage);
      this.setVideoReady(result.videoUrl, result.durationMs, result.frameUrl);
      console.log(
        `fight job ready battleId=${battleId} winnerSide=${String(result.winnerSide)} video=${result.videoUrl}`,
      );
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      if (!this.isSameBetBout(onChainBattleId)) {
        console.error(
          `fight job battleId=${battleId} failed after its bout ended (phase=${this.phase} currentBattleId=${String(this.onChainBattleId)}): ${detail}`,
        );
        return;
      }
      await this.failVideo(`Fight job failed: ${detail}`);
    }
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
