import type * as THREE from "three";
import type { CoinBoxPart, CoinBoxView } from "./coinbox.ts";

export const STAKES = [1, 3, 5];

export type Focus = {
  at: CoinBoxView | null;
  pick: boolean;
  hover: CoinBoxPart | null;
  error: string;
};
export const Z: Focus = {
  at: null,
  pick: false,
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
  reveal: -1,
  revealUntil: 0,
  stake: 1,
  hold: -1,
  holdN: 0,
  say: "",
  sayUntil: 0,
  phase: "",
  held: -1,
  hover: -1,
};

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

export const wrap = (
  g: G,
  text: string,
  x: number,
  y0: number,
  maxW: number,
  lh: number,
): number => {
  let y = y0;
  let line = "";
  for (const word of text.split(" ")) {
    const test = line ? line + " " + word : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y);
      y += lh;
      line = word;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y + lh;
};
