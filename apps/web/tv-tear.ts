export type Rect = [x: number, y: number, w: number, h: number];

const TEAR_ROWS = 10;
const TEAR_SHIFT = 24;

export function tornDraws(from: Rect, to: Rect, pick: number): [Rect, Rect][] {
  const [sx, sy, sw, sh] = from,
    [dx, dy, dw, dh] = to,
    k = dh / sh,
    row = (pick * (sh - TEAR_ROWS)) | 0,
    below = row + TEAR_ROWS;
  return [
    [
      [sx, sy, sw, row],
      [dx, dy, dw, row * k],
    ],
    [
      [sx, sy + row, sw * (1 - TEAR_SHIFT / dw), TEAR_ROWS],
      [dx + TEAR_SHIFT, dy + row * k, dw - TEAR_SHIFT, TEAR_ROWS * k],
    ],
    [
      [sx, sy + below, sw, sh - below],
      [dx, dy + below * k, dw, (sh - below) * k],
    ],
  ];
}
