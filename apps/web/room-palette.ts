import { css, rgb } from "./sprites.ts";

const V = (n: string): string => css("--" + n);
export const COL = {
  soot: V("soot"),
  char: V("char"),
  grime: V("grime"),
  rust: V("rust"),
  rustDeep: V("rust-deep"),
  blood: V("blood"),
  bloodDeep: V("blood-deep"),
  body: V("body"),
  cold: V("cold"),
  coldDeep: V("cold-deep"),
  sulfur: V("sulfur"),
  bone: V("bone"),
};

export const BARS = [
  COL.bone,
  COL.sulfur,
  COL.rust,
  COL.rustDeep,
  COL.blood,
  COL.bloodDeep,
  COL.grime,
];

export const RAMP = [COL.soot, COL.rustDeep, COL.rust, COL.bone].map(rgb);
