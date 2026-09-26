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
import type { RandomInt } from "@horror-tube/fight/rotation";

import { normalizeSuiAddress } from "@mysten/sui/utils";
import { randomUUID } from "node:crypto";

import type { BattleBettingPorts } from "../battle-betting.js";
import type { FightJobRunner } from "../fight-job.js";
import type { RoundStore } from "../db/rounds.js";
import type { PairingRunner } from "../pairing-job.js";
import type { Phase, RoundState, Tape } from "../types.js";
import type { GameLoopConfig } from "./config.js";
import { botSide, type HouseBotChain, type HouseBots } from "./house-bot.js";

export type CharRuntime = {
  id: number;
  ensLabel: string;
  alive: boolean;
  kills: number;
  damage: number;
};

export type RosterWritePorts = ChainWritePorts & {
  writeStatusAlive: (args: { subname: string }) => Promise<string>;
};

export type GameLoopOptions = {
  config: GameLoopConfig;
  ensLabels: string[];
  ensStatuses: string[];
  now?: () => number;
  randomInt?: RandomInt;
  battleQueueStore: BattleQueueStore;
  roundStore: RoundStore;
  chainWritePorts: RosterWritePorts;
  battleBetting: BattleBettingPorts;
  fightJob: FightJobRunner;
  pairing: PairingRunner;
  houseBots: HouseBots;
};

type Listener = (state: RoundState) => void;
type ChainRetry = { retryAt: number; delayMs: number };
type BotRuntime = {
  chain: HouseBotChain;
  betTriedFor: string | null;
  bet: { battleId: string; side: 0 | 1; units: bigint; digest: string } | null;
  claimedFor: string | null;
  claimRetry: ChainRetry | null;
  error: string | null;
};

const CHAIN_RETRY_FIRST_MS = 5_000;
const CHAIN_RETRY_MAX_MS = 60_000;

const due = (retry: ChainRetry | null, now: number): boolean =>
  retry === null || now >= retry.retryAt;

const errorText = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export class StartRefusedError extends Error {
  constructor(reason: string) {
    super(`start refused: ${reason}.`);
    this.name = "StartRefusedError";
  }
}

export class VoteRefusedError extends Error {
  constructor(
    readonly code: "already_voted" | "not_voting",
    message: string,
  ) {
    super(message);
    this.name = "VoteRefusedError";
  }
}

export type Voter = { kind: "human"; nullifier: string } | { kind: "bot"; address: string };

const voterKey = (voter: Voter): string =>
  voter.kind === "human" ? `human:${voter.nullifier}` : `bot:${voter.address}`;

export class FighterRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FighterRejectedError";
  }
}

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
  private readonly aliveOnEns: boolean[];
  private settleEnsWrite: Promise<void> = Promise.resolve();
  private revival: Promise<void> | null = null;
  private readonly now: () => number;
  private readonly randomInt: RandomInt;
  private readonly battleQueueStore: BattleQueueStore;
  private readonly roundStore: RoundStore;
  private readonly chainWritePorts: RosterWritePorts;
  private readonly battleBetting: BattleBettingPorts;
  private readonly fightJob: FightJobRunner;
  private readonly pairing: PairingRunner;
  private readonly bots: BotRuntime[];
  private readonly botStakeUnits: bigint;
  private botAction: Promise<void> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly pendingCancels = new Map<string, ChainRetry>();
  private cancelRetryInFlight = false;

  private chars: CharRuntime[];
  private round = 1;
  private phase: Phase = "waiting";
  private endsAt: number | null = null;
  private champion: number | null = null;
  private seasonId: string | null = null;
  private startInFlight = false;
  private readonly ballots = new Map<string, number>();
  private bookError: string | null = null;
  private pollClosing = false;
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
          `GameLoop randomInt was not provided. Pass cryptoRandomInt (or a test double) for house bot choices. maxExclusive=${String(maxExclusive)}.`,
        );
      });
    this.battleQueueStore = options.battleQueueStore;
    this.roundStore = options.roundStore;
    this.chainWritePorts = options.chainWritePorts;
    this.battleBetting = options.battleBetting;
    this.fightJob = options.fightJob;
    this.pairing = options.pairing;
    this.bots = options.houseBots.chains.map((chain) => ({
      chain,
      betTriedFor: null,
      bet: null,
      claimedFor: null,
      claimRetry: null,
      error: null,
    }));
    this.botStakeUnits = options.houseBots.stakeUnits;
    this.chars = buildChars(options.ensLabels, options.ensStatuses);
    this.aliveOnEns = this.chars.map((c) => c.alive);
    if (this.programmeFinished()) for (const c of this.chars) c.alive = true;
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
      votes: this.voteCounts(),
      voters: this.ballots.size,
      quorum: this.config.quorumVotes,
      bookError: this.bookError,
      fighters: this.fighters,
      selectable: this.selectableIds(),
      battleId: this.onChainBattleId,
      poolId: this.poolObjectId,
      pool: [this.pool[0], this.pool[1]],
      winner: this.phase === "settle" || this.phase === "over" ? this.winner : null,
      videoUrl: this.videoUrl,
      videoStartedAt: this.videoStartedAt,
      bettingClosesAt: this.bettingClosesAt,
      frameUrl: this.frameUrl,
      error: this.error,
      bots: this.bots.map((bot) => ({
        address: bot.chain.address,
        bet:
          bot.bet === null || bot.bet.battleId !== this.onChainBattleId
            ? null
            : { side: bot.bet.side, units: Number(bot.bet.units), digest: bot.bet.digest },
        error: bot.error,
      })),
      chars: this.chars.map((c) => ({
        id: c.id,
        label: c.ensLabel,
        alive: c.alive,
        kills: c.kills,
        damage: c.damage,
      })),
    };
  }

  async tick(now: number = this.now()): Promise<void> {
    await this.retryPendingCancels(now);
    if (this.settleInFlight) {
      return;
    }
    this.kickHouseBot(now);
    if (this.voting() && this.endsAt !== null && now >= this.endsAt && !this.booking()) {
      await this.closePoll();
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

  private assertBeforeCutoff(action: "bet", now: number): void {
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

  setPool(battleId: string, poolId: string, totals: [number, number]): void {
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
    if (this.lastPoolReadAt !== 0 && now - this.lastPoolReadAt < GameLoop.POOL_READ_INTERVAL_MS) {
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
      console.error(`Sui pool totals read failed (battleId=${battleId}): ${detail}`);
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

  async setVideoReady(url: string, durationMs: number, frameUrl: string): Promise<void> {
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
    const queueId = this.queuedAgentResultId;
    const battleId = this.onChainBattleId;
    if (queueId === null) {
      throw new Error(
        `setVideoReady for battle ${JSON.stringify(battleId)}: no battle_results row is attached. Cannot store fight video.`,
      );
    }
    const trimmed = url.trim();
    const closesAt = this.now() + this.config.bettingWindowSeconds * 1000;
    try {
      await this.battleQueueStore.setVideoUrl(queueId, trimmed);
      const record = await this.battleQueueStore.get(queueId);
      if (record === null) throw new Error(`battle_results row ${queueId} is missing`);
      await this.battleQueueStore.save({ ...record, bettingClosesAt: closesAt });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new StoreWriteError(
        `Storing fight video URL and betting_closes_at failed for battle ${JSON.stringify(battleId)} (battle_results ${queueId}): ${detail}`,
        { cause },
      );
    }
    this.videoUrl = trimmed;
    this.frameUrl = frameUrl.trim();
    this.videoDurationMs = durationMs;
    this.bettingClosesAt = closesAt;
    console.log(
      `video ready battleId=${String(battleId)} betting_closes_at=${new Date(closesAt).toISOString()}`,
    );
    this.emit();
  }

  async listTapes(): Promise<Tape[]> {
    const recorded = await this.battleQueueStore.listRecorded();
    return recorded
      .filter((battle) => !this.wouldLeakTheLiveWinner(battle.battleId))
      .map((battle) => ({
        battleId: battle.battleId,
        fighters: [battle.fighterASubname, battle.fighterBSubname],
        winner: battle.winnerSubname,
        injuries: battle.winnerInjuries,
        rationale: battle.rationale,
        videoUrl: battle.videoUrl,
        recordedAt: battle.recordedAt,
        statusTx: battle.statusTxHash,
      }));
  }

  private wouldLeakTheLiveWinner(battleId: string): boolean {
    return (this.phase === "bet" || this.phase === "fight") && battleId === this.onChainBattleId;
  }

  setOutcome(winner: 0 | 1, damage: number): void {
    if (this.phase !== "bet") {
      throw new Error(`setOutcome is only allowed in the bet phase. Current phase: ${this.phase}.`);
    }
    if (winner !== 0 && winner !== 1) {
      throw new Error(`setOutcome winner must be 0 or 1. Got: ${String(winner)}.`);
    }
    if (!Number.isInteger(damage) || damage < 0) {
      throw new Error(`setOutcome damage must be an integer >= 0. Got: ${String(damage)}.`);
    }
    this.outcome = { winner, damage };
  }

  async failVideo(message: string): Promise<void> {
    if (this.phase !== "bet") {
      throw new Error(`failVideo is only allowed in the bet phase. Current phase: ${this.phase}.`);
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
    await this.markSeasonEnded();
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

  async voteWithNullifier(nullifier: string, fighterId: number): Promise<void> {
    if (nullifier.trim() === "") {
      throw new Error("World ID nullifier is empty.");
    }
    this.castVote({ kind: "human", nullifier }, fighterId);
    this.emit();
  }

  private voting(): boolean {
    return this.phase === "waiting" || this.phase === "over" || this.phase === "pick";
  }

  private booking(): boolean {
    return this.startInFlight || this.pollClosing;
  }

  private castVote(voter: Voter, fighterId: number): void {
    if (!this.voting() || this.booking()) {
      throw new VoteRefusedError(
        "not_voting",
        `vote refused: fighters are chosen only before a bout (phase=${this.phase}${this.booking() ? ", a bout is opening" : ""}).`,
      );
    }
    const key = voterKey(voter);
    if (this.ballots.has(key)) {
      throw new VoteRefusedError("already_voted", `vote refused: ${key} already voted for this bout.`);
    }
    if (!this.selectableIds().includes(fighterId)) {
      const label = this.ensLabels[fighterId];
      throw new FighterRejectedError(
        label === undefined
          ? `fighter rejected: character id ${String(fighterId)} is not on the roster.`
          : `fighter rejected: ${label} (character ${String(fighterId)}) cannot be chosen now. It is dead or it is the champion who stays on.`,
      );
    }
    this.ballots.set(key, fighterId);
    this.bookError = null;
    console.log(`vote ${key} -> ${this.labelOf(fighterId)} (${String(this.ballots.size)}/${String(this.config.quorumVotes)})`);
    if (this.endsAt === null && this.ballots.size >= this.config.quorumVotes) {
      this.endsAt = this.now() + this.config.voteCountdownSeconds * 1000;
    }
  }

  private voteCounts(): number[] {
    const counts = this.ensLabels.map(() => 0);
    for (const id of this.ballots.values()) counts[id] = (counts[id] ?? 0) + 1;
    return counts;
  }

  private topVoted(): number {
    const counts = new Map<number, number>();
    let top: number | null = null;
    let topCount = 0;
    for (const id of this.ballots.values()) {
      const count = (counts.get(id) ?? 0) + 1;
      counts.set(id, count);
      if (count > topCount) {
        top = id;
        topCount = count;
      }
    }
    if (top === null) throw new Error("closePoll: the vote closed with no ballots.");
    return top;
  }

  private async closePoll(): Promise<void> {
    const fighterId = this.topVoted();
    const wasPick = this.phase === "pick";
    this.ballots.clear();
    this.endsAt = null;
    console.log(`vote closed: ${this.labelOf(fighterId)} is booked`);
    this.pollClosing = true;
    try {
      if (wasPick) await this.chooseNextFighter(fighterId);
      else await this.start(fighterId);
    } catch (cause) {
      this.bookError = `${this.labelOf(fighterId)} could not be booked: ${errorText(cause)}. Vote again.`;
      console.error(this.bookError);
      this.emit();
    } finally {
      this.pollClosing = false;
    }
  }

  async start(bookedId: number): Promise<void> {
    if (this.startInFlight) {
      throw new StartRefusedError("a fresh bout is already starting");
    }
    if (this.phase !== "waiting" && this.phase !== "over") {
      throw new StartRefusedError(
        `a bout is already open (phase=${this.phase}, round=${String(this.round)}, battleId=${String(this.onChainBattleId)})`,
      );
    }
    this.startInFlight = true;
    try {
      await this.startFreshBout(bookedId);
    } finally {
      this.startInFlight = false;
    }
  }

  async chooseNextFighter(fighterId: number): Promise<void> {
    if (this.phase !== "pick") {
      throw new StartRefusedError(
        `the next fighter is chosen only while picking (phase=${this.phase})`,
      );
    }
    if (this.champion === null) {
      throw new Error("chooseNextFighter: the champion is missing.");
    }
    const challenger = this.requireLiving(this.chars, fighterId);
    if (fighterId === this.champion) {
      throw new FighterRejectedError(
        `fighter rejected: ${challenger.ensLabel} (character ${String(fighterId)}) is the champion and stays on. Pick the next fighter.`,
      );
    }
    await this.enterBout([this.champion, fighterId]);
  }

  private async startFreshBout(bookedId: number): Promise<void> {
    await this.reviveRoster();
    const leftover = await this.roundStore.endOpenSeasons();
    if (leftover.length > 0) {
      console.warn(`start: ended leftover open season(s) ${leftover.join(",")}`);
    }
    const chars = this.ensLabels.map((ensLabel, id): CharRuntime => {
      const alive = this.aliveOnEns[id];
      if (alive === undefined) {
        throw new Error(
          `start: missing initial alive flag for ${ensLabel} at index ${String(id)}.`,
        );
      }
      return { id, ensLabel, alive, kills: 0, damage: 0 };
    });
    this.requireLiving(chars, bookedId);
    const fighters = this.randomOpeningPair(chars, bookedId);
    const seasonId = await this.roundStore.startSeason(
      chars.map((c) => ({
        ensLabel: c.ensLabel,
        alive: c.alive,
        kills: c.kills,
        damage: c.damage,
      })),
    );
    this.seasonId = seasonId;
    this.chars = chars;
    this.champion = null;
    this.round = 1;
    this.frameUrl = null;
    this.winner = null;
    this.outcome = null;
    this.videoDurationMs = null;
    this.queuedAgentResultId = null;
    this.pool = [0, 0];
    console.log(
      `start: season ${seasonId} fresh bout ${this.labelOf(fighters[0])} vs ${this.labelOf(fighters[1])}`,
    );
    try {
      await this.enterBout(fighters);
    } catch (cause) {
      await this.markSeasonEnded();
      throw cause;
    }
  }

  private randomOpeningPair(chars: CharRuntime[], bookedId: number): [number, number] {
    const others = chars.filter((c) => c.alive && c.id !== bookedId);
    if (others.length === 0) {
      const living = chars.filter((c) => c.alive).length;
      throw new Error(
        `start: fewer than 2 living characters remain (living=${String(living)}, booked=${this.labelOf(bookedId)}).`,
      );
    }
    const index = this.randomInt(others.length);
    if (!Number.isInteger(index) || index < 0 || index >= others.length) {
      throw new Error(
        `start: randomInt(${String(others.length)}) must return an integer in [0, ${String(others.length)}). Got: ${JSON.stringify(index)}.`,
      );
    }
    const opponent = others[index];
    if (opponent === undefined) {
      throw new Error(`start: random opponent index ${String(index)} is missing.`);
    }
    return [bookedId, opponent.id];
  }

  private idOf(ensLabel: string): number {
    const id = this.ensLabels.indexOf(ensLabel);
    if (id < 0) {
      throw new Error(`${JSON.stringify(ensLabel)} is not in ROSTER_ENS_LABELS.`);
    }
    return id;
  }

  private async enterBout(fighters: [number, number]): Promise<void> {
    const seasonId = this.seasonId;
    if (seasonId === null) {
      throw new Error(`enterBout: round ${String(this.round)} has no open season.`);
    }
    try {
      await this.roundStore.startRound({
        seasonId,
        roundNumber: this.round,
        championLabel: this.champion === null ? null : this.labelOf(this.champion),
        fighterALabel: this.labelOf(fighters[0]),
        fighterBLabel: this.labelOf(fighters[1]),
      });
    } catch (cause) {
      throw new StoreWriteError(
        `Round insert failed for round ${String(this.round)} (season ${seasonId}): ${errorText(cause)}.`,
        { cause },
      );
    }
    this.fighters = fighters;
    await this.enterBet(this.now());
  }

  private async markSeasonEnded(): Promise<void> {
    const seasonId = this.seasonId;
    if (seasonId === null) return;
    this.seasonId = null;
    const championLabel = this.champion === null ? null : this.labelOf(this.champion);
    try {
      await this.roundStore.endSeason(seasonId, championLabel);
      console.log(`season ${seasonId} ended champion=${String(championLabel)}`);
    } catch (cause) {
      console.error(
        `season ${seasonId} end write failed: ${errorText(cause)}. The next start ends it as a leftover season.`,
      );
    }
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
    const closesAt = this.bettingClosesAt;
    if (closesAt === null || now < closesAt) return;
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
    const startedAt = this.now();
    await this.storeVideoStart(startedAt);
    this.error = null;
    this.winner = this.outcome.winner;
    this.settleDamage = this.outcome.damage;
    this.bettingClosedGate = true;
    this.phase = "fight";
    this.videoStartedAt = startedAt;
    this.endsAt = startedAt + this.videoDurationMs;
    this.emit();
  }

  private async storeVideoStart(startedAt: number): Promise<void> {
    const queueId = this.queuedAgentResultId;
    try {
      if (queueId === null) throw new Error("no battle_results row is attached");
      const record = await this.battleQueueStore.get(queueId);
      if (record === null) throw new Error(`battle_results row ${queueId} is missing`);
      await this.battleQueueStore.save({ ...record, videoStartedAt: startedAt });
    } catch (cause) {
      console.error(
        `Storing video_started_at failed for battle ${String(this.onChainBattleId)} (battle_results ${String(queueId)}): ${errorText(cause)}. The fight starts anyway.`,
      );
    }
  }

  async retrySettle(): Promise<void> {
    if (this.settleInFlight) {
      throw new Error(
        `retrySettle refused: a settle is already running for round ${String(this.round)}.`,
      );
    }
    if (this.error === null) {
      throw new Error("retrySettle requires a failed settle. Current error is empty.");
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
    if (queued.winnerSubname !== winnerLabel || queued.loserSubname !== loserLabel) {
      throw new Error(
        `enterSettle: agent result winner=${JSON.stringify(queued.winnerSubname)} loser=${JSON.stringify(queued.loserSubname)} does not match bout winner=${JSON.stringify(winnerLabel)} loser=${JSON.stringify(loserLabel)}.`,
      );
    }
    if (!this.holdingCopyApplied) {
      loserChar.alive = false;
      this.aliveOnEns[loserId] = false;
      winnerChar.kills += 1;
      winnerChar.damage += this.settleDamage;
      this.champion = winnerId;
      this.holdingCopyApplied = true;
    }
    this.phase = "settle";
    this.endsAt = now + this.config.settleSeconds * 1000;
    this.emit();
    this.settleEnsWrite = this.writeQueuedEns(queued);
  }

  private async writeQueuedEns(queued: BattleQueueRecord): Promise<void> {
    const queueId = queued.id;
    try {
      let record = markPlaybackFinished(markBettingClosed(queued));
      await this.battleQueueStore.save(record);
      console.log(`ENS settle start queueId=${record.id} battleId=${record.battleId}`);
      record = await settleQueuedBattle(record, this.chainWritePorts, this.battleQueueStore);
      console.log(
        `ENS settle done queueId=${record.id} injuriesTx=${record.injuriesTxHash} statusTx=${record.statusTxHash} settlementTx=${record.settlementTxHash}`,
      );
      if (this.queuedAgentResultId !== queueId) return;
      this.error = null;
      this.emit();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`ENS settle failed queueId=${queueId}: ${message}`);
    }
  }

  private async afterSettle(): Promise<void> {
    if (this.error !== null) {
      return;
    }
    this.endsAt = null;
    const alive = this.chars.filter((c) => c.alive);
    if (alive.length <= 1) {
      this.phase = "over";
      this.endsAt = null;
      await this.markSeasonEnded();
      this.emit();
      this.reviveRoster().catch((cause: unknown) => {
        console.error(`roster revival failed: ${errorText(cause)}. The next start retries it.`);
      });
      return;
    }
    if (this.champion === null) {
      throw new Error("afterSettle: champion is required before the next fighter can be picked.");
    }
    this.round += 1;
    this.winner = null;
    this.pool = [0, 0];
    this.outcome = null;
    this.videoDurationMs = null;
    this.queuedAgentResultId = null;
    this.fighters = null;
    this.phase = "pick";
    this.endsAt = null;
    this.error = null;
    this.emit();
  }

  private requireLiving(chars: CharRuntime[], id: number): CharRuntime {
    const char = chars[id];
    if (char === undefined) {
      throw new FighterRejectedError(
        `fighter rejected: character id ${String(id)} is not on the roster.`,
      );
    }
    if (!char.alive) {
      throw new FighterRejectedError(
        `fighter rejected: ${char.ensLabel} (character ${String(id)}) is dead and cannot fight.`,
      );
    }
    return char;
  }

  private programmeFinished(): boolean {
    return this.aliveOnEns.filter(Boolean).length < 2;
  }

  private reviveRoster(): Promise<void> {
    if (!this.programmeFinished()) return Promise.resolve();
    this.revival ??= (async () => {
      await this.settleEnsWrite;
      for (const [id, alive] of this.aliveOnEns.entries()) {
        if (alive) continue;
        const label = this.labelOf(id);
        const tx = await this.chainWritePorts.writeStatusAlive({ subname: label });
        this.aliveOnEns[id] = true;
        console.log(`roster revival: ${label} status=alive tx=${tx}`);
      }
    })().finally(() => {
      this.revival = null;
    });
    return this.revival;
  }

  private selectableIds(): number[] {
    if (this.phase === "waiting" || this.phase === "over") {
      if (this.programmeFinished()) return this.ensLabels.map((_, id) => id);
      return this.aliveOnEns.flatMap((alive, id) => (alive ? [id] : []));
    }
    if (this.phase === "pick" && this.champion !== null) {
      return this.chars.filter((c) => c.alive && c.id !== this.champion).map((c) => c.id);
    }
    return [];
  }

  private async enterBet(now: number): Promise<void> {
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
        this.config.bettingWindowSeconds +
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

  private kickHouseBot(now: number): void {
    if (this.botAction !== null) return;
    let action: (() => Promise<void>) | null = null;
    for (const bot of this.bots) {
      if (this.wantsBotVote(bot)) action = async () => this.botVote(bot);
      else if (this.wantsBotBet(bot, now)) action = () => this.botBet(bot);
      else if (this.wantsBotClaim(bot, now)) action = () => this.botClaim(bot, now);
      if (action !== null) break;
    }
    if (action === null) return;
    this.botAction = action()
      .catch((cause: unknown) => {
        console.error(`house bot action failed unexpectedly: ${errorText(cause)}`);
      })
      .finally(() => {
        this.botAction = null;
      });
  }

  private wantsBotVote(bot: BotRuntime): boolean {
    if (!this.voting() || this.booking()) return false;
    if (this.ballots.has(voterKey({ kind: "bot", address: bot.chain.address }))) return false;
    return [...this.ballots.keys()].some((key) => key.startsWith("human:"));
  }

  private botVote(bot: BotRuntime): void {
    const choices = this.selectableIds();
    if (choices.length === 0) return;
    const pick = choices[this.randomInt(choices.length)];
    if (pick === undefined) return;
    try {
      this.castVote({ kind: "bot", address: bot.chain.address }, pick);
      bot.error = null;
    } catch (cause) {
      bot.error = `House bot ${bot.chain.address} vote failed: ${errorText(cause)}`;
      console.error(bot.error);
    }
    this.emit();
  }

  private humanStake(battleId: string): [number, number] {
    const stake: [number, number] = [this.pool[0], this.pool[1]];
    for (const bot of this.bots) {
      if (bot.bet?.battleId === battleId) stake[bot.bet.side] -= Number(bot.bet.units);
    }
    return [Math.max(0, stake[0]), Math.max(0, stake[1])];
  }

  private wantsBotBet(bot: BotRuntime, now: number): boolean {
    const battleId = this.onChainBattleId;
    if (this.phase !== "bet" || this.error !== null || battleId === null) return false;
    if (this.poolObjectId === null || bot.betTriedFor === battleId) return false;
    if (this.bettingClosesAt !== null && now >= this.bettingClosesAt) return false;
    const human = this.humanStake(battleId);
    return human[0] + human[1] > 0 || this.videoUrl !== null;
  }

  private async botBet(bot: BotRuntime): Promise<void> {
    const battleId = this.onChainBattleId;
    const poolId = this.poolObjectId;
    if (battleId === null || poolId === null) return;
    const round = this.round;
    const address = bot.chain.address;
    const units = this.botStakeUnits;
    // WARNING: one bet attempt per bout. A timed-out bet may still land, so a retry could stake twice.
    bot.betTriedFor = battleId;
    const side = botSide(this.humanStake(battleId), this.randomInt);
    try {
      const digest = await bot.chain.bet(poolId, side, units);
      bot.bet = { battleId, side, units, digest };
      bot.error = null;
      if (this.onChainBattleId === battleId) this.pool[side] += Number(units);
      console.log(
        `house bot ${address} bet battleId=${battleId} round=${String(round)} side=${String(side)} units=${String(units)} digest=${digest}`,
      );
    } catch (cause) {
      bot.error = `House bot ${address} bet failed (battleId=${battleId}, round ${String(round)}): ${errorText(cause)}. It sits this bout out.`;
      console.error(bot.error);
    }
    this.emit();
  }

  private wantsBotClaim(bot: BotRuntime, now: number): boolean {
    return (
      this.phase === "settle" &&
      this.error === null &&
      bot.bet !== null &&
      bot.claimedFor !== bot.bet.battleId &&
      due(bot.claimRetry, now)
    );
  }

  private async botClaim(bot: BotRuntime, now: number): Promise<void> {
    if (bot.bet === null) return;
    const battleId = bot.bet.battleId;
    const address = bot.chain.address;
    try {
      const claimed = await bot.chain.claimFinished();
      bot.claimedFor = battleId;
      bot.claimRetry = null;
      bot.error = null;
      console.log(
        claimed === null
          ? `house bot ${address} has no finished tickets after battleId=${battleId}`
          : `house bot ${address} claimed ${String(claimed.tickets)} ticket(s) after battleId=${battleId} digest=${claimed.digest}`,
      );
    } catch (cause) {
      bot.claimRetry = nextChainRetry(now, bot.claimRetry);
      bot.error = `House bot ${address} claim failed after battleId=${battleId} (round ${String(this.round)}): ${errorText(cause)}. Retrying in ${String(bot.claimRetry.delayMs)} ms.`;
      console.error(bot.error);
    }
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
          throw new Error(`Fight job: character id ${String(c.id)} has no ENS label.`);
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
      await this.setVideoReady(result.videoUrl, result.durationMs, result.frameUrl);
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

  private emit(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
