import type * as THREE from "three";
import type { CoinBoxPart, CoinBoxView } from "./coinbox.ts";
import type { Tape } from "../server/src/types.ts";

export const STAKES = [1, 3, 5];

export type Focus = {
  at: CoinBoxView | null;
  hover: CoinBoxPart | null;
  error: string;
};
export const Z: Focus = {
  at: null,
  hover: null,
  error: "",
};

export type WalkStep = {
  say: string;
  view: () => [eye: THREE.Vector3, target: THREE.Vector3] | null;
  remote: boolean;
};
export const walkRef = { n: -1 };

export const num = (n: number): string => String(n).padStart(2, "0");

export const T = {
  buf: "",
  betSide: -1,
  stake: 1,
  hold: -1,
  holdN: 0,
  say: "",
  sayUntil: 0,
  phase: "",
};

const tapes: Tape[] = [];
export const VCR = {
  tapes,
  held: "",
  loaded: "",
  hover: "",
  over: false,
};
export const reelById = (id: string): Tape | undefined =>
  id === "" ? undefined : VCR.tapes.find((t) => t.battleId === id);
export const boutNumber = (tape: Tape): number => VCR.tapes.indexOf(tape) + 1;

export const say = (text: string, ms = 3600): void => {
  T.say = text;
  T.sayUntil = performance.now() + ms;
};

export const LOW = matchMedia("(prefers-reduced-motion: reduce)").matches;

export type Step = "read" | "ink" | "scan" | "wallet" | "signed" | "done" | "off" | "burn" | "dark";
export type Waiver = {
  step: Step;
  at: number;
  ink: number;
  qrUri: string;
  fail: string;
  down: string;
};
export const W8: Waiver = { step: "read", at: 0, ink: 0, qrUri: "", fail: "", down: "" };

export type G = CanvasRenderingContext2D;

export const lines = (g: G, text: string, maxW: number): string[] => {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (g.measureText(test).width > maxW && line) {
      out.push(line);
      line = word;
    } else line = test;
  }
  if (line) out.push(line);
  return out;
};

export const wrap = (
  g: G,
  text: string,
  x: number,
  y0: number,
  maxW: number,
  lh: number,
): number => {
  const ls = lines(g, text, maxW);
  ls.forEach((l, i) => g.fillText(l, x, y0 + i * lh));
  return y0 + Math.max(ls.length, 1) * lh;
};

export const fitFont = (
  g: G,
  family: string,
  max: number,
  min: number,
  fits: (lh: number) => boolean,
): number => {
  let size = max;
  for (; size > min; size--) {
    g.font = `${size}px ${family}`;
    if (fits(Math.round(size * 1.3))) break;
  }
  g.font = `${size}px ${family}`;
  return Math.round(size * 1.3);
};
