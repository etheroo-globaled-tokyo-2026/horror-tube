import { requiredEnv } from "@horror-tube/betting";
import {
  parseInjuries,
  readRosterFromChain,
  type CharacterSheet,
} from "@horror-tube/ens/roster";
import type { LivingCard } from "@horror-tube/fight";
import { loadEthRegistryAddress, parseEnsLabel } from "./ens-chain-write.js";

export type RosterSnapshot = {
  parentName: string;
  sheets: CharacterSheet[];
};

export type RosterReader = () => Promise<RosterSnapshot>;

export type RosterTextTarget = {
  sheet(subname: string): CharacterSheet;
  applyTextWrite(subname: string, key: "status" | "injuries", value: string): void;
};

type TextOverlay = {
  status?: string;
  injuries?: string;
};

export type RefreshHandle = {
  stop: () => void;
};

export type RefreshScheduler = (run: () => void, intervalMs: number) => RefreshHandle;

function intervalScheduler(run: () => void, intervalMs: number): RefreshHandle {
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

function patchSheet(
  snapshot: RosterSnapshot,
  subname: string,
  key: "status" | "injuries",
  value: string,
): RosterSnapshot {
  const index = snapshot.sheets.findIndex((sheet) => sheet.label === subname);
  if (index < 0) {
    throw new Error(
      `ENS roster cache has no sheet for ${JSON.stringify(subname)}.`,
    );
  }
  const current = snapshot.sheets[index];
  if (current === undefined) {
    throw new Error(
      `ENS roster cache has no sheet for ${JSON.stringify(subname)}.`,
    );
  }
  const next: CharacterSheet =
    key === "status"
      ? { ...current, status: value }
      : { ...current, injuries: parseInjuries(subname, value) };
  const sheets = snapshot.sheets.slice();
  sheets[index] = next;
  return { parentName: snapshot.parentName, sheets };
}

export async function readEnsRosterSnapshot(
  env: NodeJS.ProcessEnv = process.env,
): Promise<RosterSnapshot> {
  const ensLabel = parseEnsLabel(requiredEnv("ENS_LABEL", env));
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL", env);
  const ethRegistry = loadEthRegistryAddress();
  return readRosterFromChain(ensLabel, rpcUrl, ethRegistry);
}

export type EnsRosterCache = RosterTextTarget & {
  snapshot(): RosterSnapshot;
  statuses(subnames: readonly string[]): string[];
  livingCards(subnames: readonly string[]): LivingCard[];
  refresh(): Promise<void>;
  stop(): void;
};

export async function openEnsRosterCache(options: {
  read: RosterReader;
  refreshMs: number;
  schedule?: RefreshScheduler;
}): Promise<EnsRosterCache> {
  let current = await options.read();
  console.log(
    `ENS roster cache filled parent=${current.parentName} labels=${String(current.sheets.length)}`,
  );
  let refreshing = false;
  let inflight: Map<string, TextOverlay> | null = null;
  let stopped = false;

  const applyTextWrite = (
    subname: string,
    key: "status" | "injuries",
    value: string,
  ): void => {
    current = patchSheet(current, subname, key, value);
    if (inflight === null) {
      return;
    }
    const overlay = inflight.get(subname) ?? {};
    if (key === "status") {
      overlay.status = value;
    } else {
      overlay.injuries = value;
    }
    inflight.set(subname, overlay);
  };

  const sheet = (subname: string): CharacterSheet => {
    const found = current.sheets.find((item) => item.label === subname);
    if (found === undefined) {
      throw new Error(
        `ENS roster cache has no sheet for ${JSON.stringify(subname)}.`,
      );
    }
    return found;
  };

  const refresh = async (): Promise<void> => {
    if (stopped || refreshing) {
      return;
    }
    refreshing = true;
    const overlays = new Map<string, TextOverlay>();
    inflight = overlays;
    console.log("ENS roster refresh started");
    try {
      let next = await options.read();
      for (const [subname, overlay] of overlays) {
        if (overlay.injuries !== undefined) {
          next = patchSheet(next, subname, "injuries", overlay.injuries);
        }
        if (overlay.status !== undefined) {
          next = patchSheet(next, subname, "status", overlay.status);
        }
      }
      current = next;
      console.log(
        `ENS roster cache refreshed parent=${current.parentName} labels=${String(current.sheets.length)}`,
      );
    } finally {
      inflight = null;
      refreshing = false;
    }
  };

  const schedule = options.schedule ?? intervalScheduler;
  const handle = schedule(() => {
    void refresh().catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      console.error(`ENS roster cache refresh failed: ${message}`);
    });
  }, options.refreshMs);

  return {
    snapshot: () => ({
      parentName: current.parentName,
      sheets: current.sheets.slice(),
    }),
    sheet,
    statuses: (subnames) => subnames.map((subname) => sheet(subname).status),
    livingCards: (subnames) => livingCardsFromSnapshot(sheet, subnames),
    applyTextWrite,
    refresh,
    stop: () => {
      stopped = true;
      handle.stop();
    },
  };
}

function livingCardsFromSnapshot(
  sheet: (subname: string) => CharacterSheet,
  subnames: readonly string[],
): LivingCard[] {
  if (subnames.length === 0) {
    throw new Error("ENS roster cache living cards require at least one subname.");
  }
  return subnames.map((subname) => {
    const trimmed = subname.trim();
    if (trimmed === "") {
      throw new Error("ENS roster cache living cards: blank subname.");
    }
    const found = sheet(trimmed);
    if (found.look.trim() === "") {
      throw new Error(
        `${trimmed}: look text record is blank. Refusing to narrate without a look.`,
      );
    }
    if (found.brief.trim() === "") {
      throw new Error(
        `${trimmed}: brief text record is blank. Refusing to narrate without a brief.`,
      );
    }
    const status = found.status.trim();
    if (status === "dead") {
      throw new Error(
        `${trimmed}: ENS status is dead. Fight job requires a living card.`,
      );
    }
    if (status !== "" && status !== "alive") {
      throw new Error(
        `${trimmed}: ENS status must be "alive", "dead", or blank. Got ${JSON.stringify(found.status)}.`,
      );
    }
    return {
      subname: trimmed,
      look: found.look.trim(),
      brief: found.brief.trim(),
      injuries: found.injuries.slice(),
      status: "alive",
    };
  });
}
