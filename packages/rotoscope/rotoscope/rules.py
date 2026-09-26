"""The rules that decide what each frame draws: which finds are kept, who each character is, and who holds what.
Every mask is bool (ANALYSIS_H, ANALYSIS_W) and every distance is in pixels at that size. A frame's "shot" here is
its run between detected cuts: nothing carries across a cut."""
from dataclasses import dataclass, replace
from typing import Sequence

import cv2
import numpy as np

from rotoscope.config import Rules
from rotoscope.shots import SIDES, CastMember, Shot, same_find
from rotoscope.types import ANALYSIS_H, ANALYSIS_W, Find

Joints = Sequence[tuple[float, float]]
Hold = tuple[int | None, str | None]        # (figure index, "hand", "body" or "carried"), or LOOSE
LOOSE: Hold = (None, None)
Placed = Sequence[tuple[str, tuple[int, int, int, int]]]     # (prop key, box) pairs


@dataclass(frozen=True)
class Rejected:
    find: Find
    why: str


@dataclass
class Decision:
    """One frame's cast and prop finds, kept or rejected."""
    kept: list[Find]
    rejected: list[Rejected]


@dataclass
class Scene:
    """Who has what in one frame."""
    figures: list[Find]         # the characters drawn
    ids: list[str]              # each figure's cast id
    far: list[Find]             # characters too small to draw
    props: list[Find]
    own: list[Hold]             # each prop's holder
    rejected: list[Rejected]

    def holder(self, i: int) -> str | None:
        """The cast id holding or wearing prop i, or None: loose."""
        o = self.own[i][0]
        return None if o is None else self.ids[o]


def box_of(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.nonzero(mask)
    return (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1) if len(xs) else (0, 0, 0, 0)


def box_iou(a: Sequence[int], b: Sequence[int]) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - ix * iy
    return ix * iy / union if union else 0.0


def _area(m: np.ndarray) -> int:
    return int(m.sum())


def one_object(a: np.ndarray, b: np.ndarray, cfg: Rules) -> bool:
    """Two masks of one kind are one object: they overlap by cfg.same_object (IoU), or the smaller lies
    cfg.contained inside the other (a thumbstick on its controller, a sleeve found apart from its wearer)."""
    inter = int((a & b).sum())
    if not inter:
        return False
    return (inter / int((a | b).sum()) >= cfg.same_object
            or inter / max(1, min(_area(a), _area(b))) >= cfg.contained)


def _gap(m: np.ndarray) -> np.ndarray:
    """Each pixel's distance to the mask."""
    return cv2.distanceTransform((~m).astype(np.uint8), cv2.DIST_L2, 3)


def at(x: float, y: float) -> tuple[int, int]:
    """A joint's (row, column), clamped to the frame."""
    return min(ANALYSIS_H - 1, max(0, int(y))), min(ANALYSIS_W - 1, max(0, int(x)))


def foreground(f: Find, cfg: Rules) -> bool:
    """A character is at least cfg.foreground of the frame tall; a smaller one is in the background, not drawn."""
    return f.box[3] - f.box[1] >= cfg.foreground * ANALYSIS_H


def _placed(f: Find, pairs: Placed, cfg: Rules) -> bool:
    return any(k == f.key and box_iou(b, f.box) >= cfg.same_place for k, b in pairs)


def classify(finds: Sequence[Find], cfg: Rules, support: Placed = (), here: Placed = ()) -> Decision:
    """One label per object among one frame's cast and prop finds, in score order. The cast needs cfg.cast_min; a
    prop needs cfg.prop_min, or cfg.prop_stay when support (the props kept at prop_min in nearby frames of the shot)
    has the same prop at the same place and here (the props this frame keeps at prop_min) doesn't: it dipped for a
    frame, it isn't a second find of one already kept. Each cast member keeps its best-scoring mask. A cast find lying
    cfg.figure_in inside a kept prop is part of it (a figure on a crucifix, a doll), not a character."""
    kept: list[Find] = []
    rejected: list[Rejected] = []
    for f in sorted((f for f in finds if f.kind in ("cast", "prop")), key=lambda f: -f.score):
        floor = cfg.prop_min if f.kind == "prop" else cfg.cast_min
        if f.score < floor and not (f.kind == "prop" and f.score >= min(cfg.prop_stay, cfg.prop_min)
                                    and _placed(f, support, cfg) and not _placed(f, here, cfg)):
            rejected.append(Rejected(f, f"below {floor}"))
            continue
        if f.kind == "cast" and any(k.kind == "cast" and k.key == f.key for k in kept):
            rejected.append(Rejected(f, f"{f.key} keeps its best-scoring mask"))
            continue
        same = next((k for k in kept if k.kind == f.kind and one_object(f.mask, k.mask, cfg)), None)
        if same is not None:
            rejected.append(Rejected(f, f"one object with {same.key} {same.score:.2f}"))
            continue
        kept.append(f)
    props = [k for k in kept if k.kind == "prop"]
    figures_in_props = set()
    for f in kept:
        if f.kind != "cast" or not props:
            continue
        host = max(props, key=lambda p: int((f.mask & p.mask).sum()))
        if (f.mask & host.mask).sum() >= cfg.figure_in * max(1, _area(f.mask)):
            rejected.append(Rejected(f, f"inside {host.key} {host.score:.2f}: part of the prop, not a character"))
            figures_in_props.add(id(f))
    return Decision([k for k in kept if id(k) not in figures_in_props], rejected)


def decisions(frames: Sequence[Sequence[Find]], shots: Sequence[int], cfg: Rules) -> list[Decision]:
    """classify() for every frame, in two passes: first at the plain floors, then with the props the first pass kept
    within cfg.near frames of the same shot as support. A tracked find is weak where only the tracker has it (a fill)
    or the finder saw it under cfg.clear. A weak find is kept only if the same track was kept in the nearest frame of
    the shot where the finder saw it clearly, it hasn't shrunk under cfg.shrink of its size there, it wasn't a
    background character there, and it isn't one object with something kept here (the tracker's mask drifts inside
    the object's own find). shots: each frame's shot."""
    n = len(frames)

    def weak(f: Find) -> bool:
        return f.track is not None and (f.fill or f.score < cfg.clear)

    clear = [[f for f in fr if not weak(f)] for fr in frames]
    sure = [[(k.key, k.box) for k in classify(fr, cfg).kept if k.kind == "prop"] for fr in clear]
    out = []
    for k, fr in enumerate(clear):
        nearby = [x for j in range(max(0, k - cfg.near), min(n, k + cfg.near + 1))
                  if j != k and shots[j] == shots[k] for x in sure[j]]
        out.append(classify(fr, cfg, nearby, sure[k]))
    # a track is one object under one key: prompts that share a text share the segmenter's tracks
    sighted = [{(f.key, f.track): f for f in fr if f.track is not None} for fr in clear]
    kept_tracks = [{(f.key, f.track) for f in d.kept if f.track is not None} for d in out]
    for k, fr in enumerate(frames):
        d = out[k]
        for f in fr:
            if f.kind not in ("cast", "prop") or not weak(f):
                continue
            t = (f.key, f.track)
            j = next((j for step in range(1, n) for j in (k - step, k + step)
                      if 0 <= j < n and shots[j] == shots[k] and t in sighted[j]), None)
            ref = sighted[j][t] if j is not None else None
            if ref is None or t not in kept_tracks[j]:
                why = "tracked, but not kept where the finder saw it clearly"
            elif _area(f.mask) < cfg.shrink * _area(ref.mask):
                why = f"tracked, but shrunk to {_area(f.mask)} px from {_area(ref.mask)} px: the tracker lost it"
            elif f.kind == "cast" and not foreground(ref, cfg):
                why = "tracked, but in the background where the finder saw it clearly"
            elif f.kind == "cast" and any(x.kind == "cast" and x.key == f.key for x in d.kept):
                why = f"{f.key} keeps its best-scoring mask"
            elif any(x.kind == f.kind and one_object(f.mask, x.mask, cfg) for x in d.kept):
                why = "tracked, and one object with something kept here"
            else:
                d.kept.append(replace(f, score=ref.score))
                continue
            d.rejected.append(Rejected(f, why))
    return out


def lanes(masks: Sequence[np.ndarray]) -> list[int]:
    """Each mask's seat, counting from the left."""
    xs = [np.nonzero(m)[1].mean() if m.any() else 0.0 for m in masks]
    seat = [0] * len(masks)
    for rank, i in enumerate(np.argsort(xs, kind="stable")):
        seat[i] = rank
    return seat


def identity(figures: Sequence[Find], cast: Sequence[CastMember]) -> list[str]:
    """Which character each figure is: the cast id whose description found it. Cast members who share one
    description can't be told apart by it, so the figures it found take their ids by seat: the members in order of
    side, the figures left to right. parse() makes sure each of them has a side."""
    ids = [f.key for f in figures]
    groups: dict[str, list[CastMember]] = {}
    for c in cast:
        groups.setdefault(same_find(c.find), []).append(c)
    for members in groups.values():
        if len(members) < 2:
            continue
        keys = {m.id for m in members}
        found = [i for i, f in enumerate(figures) if f.key in keys]
        order = sorted(members, key=lambda m: SIDES.index(m.side))
        for i, seat in zip(found, lanes([figures[i].mask for i in found])):
            ids[i] = order[seat].id
    return ids


def hand_owners(figures: Sequence[np.ndarray], hands: Sequence[Joints], cfg: Rules) -> list[int | None]:
    """Which figure each hand belongs to: the one whose mask holds most of its joints, else the nearest within
    cfg.hand_owner_reach."""
    far = [_gap(m) for m in figures]
    out: list[int | None] = []
    for joints in hands:
        pts = [at(x, y) for x, y in joints]
        inside = [sum(bool(m[p]) for p in pts) for m in figures]
        if inside and max(inside) > 0:
            out.append(int(np.argmax(inside)))
            continue
        d = [float(np.median([f[p] for p in pts])) for f in far]
        out.append(int(np.argmin(d)) if d and min(d) <= cfg.hand_owner_reach else None)
    return out


def real_hands(figures: Sequence[np.ndarray], props: Sequence[np.ndarray], hands: Sequence[Joints],
               cfg: Rules) -> list[Joints]:
    """The hands that can hold something: not a hand with cfg.on_prop of its joints on one prop's surface (the hand
    model took the prop for a hand), and not a wrist farther than cfg.wrist_reach from every figure (a guess where
    the arm is hidden)."""
    far = [_gap(m) for m in figures]
    out = []
    for joints in hands:
        if len(joints) > 1 and any(sum(bool(pm[at(x, y)]) for x, y in joints) / len(joints) >= cfg.on_prop
                                   for pm in props):
            continue
        if len(joints) == 1 and not any(f[at(*joints[0])] <= cfg.wrist_reach for f in far):
            continue
        out.append(joints)
    return out


def outline(m: np.ndarray) -> np.ndarray:
    """A figure's silhouette with its holes filled: a prop held in front of the body leaves a hole in their mask,
    and lies inside this."""
    cs, _ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = np.zeros(m.shape, np.uint8)
    cv2.drawContours(out, cs, -1, 1, -1)
    return out > 0


def owners(figures: Sequence[np.ndarray], props: Sequence[np.ndarray], held: Sequence[bool],
           hands: Sequence[Joints], sam_hands: Sequence[np.ndarray], cfg: Rules) -> list[Hold]:
    """Each prop's holder. Worn or held against the body: cfg.worn of it inside a figure's filled outline. The
    hand rules apply only to a prop the shot list says is held (held[i]): a real hand's joint within cfg.hand_reach
    of it; a hand or wrist just above it (up to its height above its top, within half its width of its sides), for a
    handle its mask misses; else a SAM "hand" (sam_hands) touching it or just above it, for the figure that hand lies
    on, where the hand model sees no hand (a dark fist)."""
    hands = real_hands(figures, props, hands, cfg)
    who = hand_owners(figures, hands, cfg)
    filled = [outline(m) for m in figures]
    grow = np.ones((cfg.touch, cfg.touch), np.uint8)
    out: list[Hold] = []
    for pm, is_held in zip(props, held):
        if is_held:
            gap = _gap(pm)
            best = min(((min(float(gap[at(x, y)]) for x, y in joints), p) for joints, p in zip(hands, who)
                        if p is not None), default=None)
            if best is not None and best[0] <= cfg.hand_reach:
                out.append((best[1], "hand"))
                continue
        area = max(1, _area(pm))
        inside = [int((pm & m).sum()) / area for m in filled]
        if inside and max(inside) >= cfg.worn:
            out.append((int(np.argmax(inside)), "body"))
            continue
        if is_held:
            x0, y0, x1, y1 = box_of(pm)
            w, h = x1 - x0, y1 - y0
            above = [(y0 - y, p) for joints, p in zip(hands, who) if p is not None for x, y in joints
                     if x0 - w / 2 <= x <= x1 + w / 2 and y0 - h <= y <= y0]
            if above:
                out.append((min(above)[1], "hand"))
                continue
            zone = np.zeros_like(pm)
            zone[max(0, y0 - h):y0 + 1, max(0, int(x0 - w / 2)):int(x1 + w / 2) + 1] = True
            near = (cv2.dilate(pm.astype(np.uint8), grow) > 0) | zone
            holder = next((int(np.argmax(on)) for hm in sam_hands if (hm & near).any()
                           for on in [[int((hm & m).sum()) for m in figures]] if on and max(on) > 0), None)
            if holder is not None:
                out.append((holder, "hand"))
                continue
        out.append(LOOSE)
    return out


def sam_hands(finds: Sequence[Find], cfg: Rules) -> list[np.ndarray]:
    """The masks of a frame's SAM "hand" finds sure enough to hold something."""
    return [f.mask for f in finds if f.kind == "hand" and not f.fill and f.score >= cfg.sam_hand_min]


def assign(d: Decision, hands: Sequence[Joints], sam_hand_masks: Sequence[np.ndarray], shot: Shot,
           cfg: Rules) -> Scene:
    """Who has what in one frame: the characters drawn and who each is (identity), those too far off to draw, and
    each kept prop with its holder. A figure holds one of each prop: props go in score order, and a second copy in
    the same hands is a look-alike."""
    figures = [f for f in d.kept if f.kind == "cast" and foreground(f, cfg)]
    far = [f for f in d.kept if f.kind == "cast" and not foreground(f, cfg)]
    props = sorted((f for f in d.kept if f.kind == "prop"), key=lambda f: -f.score)
    ids = identity(figures, shot.cast)
    held = shot.held()
    holds = owners([f.mask for f in figures], [p.mask for p in props], [p.key in held for p in props],
                   hands, sam_hand_masks, cfg)
    first: dict[tuple[int | None, str], Find] = {}
    keep, own, rejected = [], [], list(d.rejected)
    for p, (o, how) in zip(props, holds):
        if how == "hand":
            if (o, p.key) in first:
                rejected.append(Rejected(p, f"{ids[o]} already holds a {p.key} {first[(o, p.key)].score:.2f}"))
                continue
            first[(o, p.key)] = p
        keep.append(p)
        own.append((o, how))
    return Scene(figures, ids, far, keep, own, rejected)


def same_object(a: Find, b: Find, cfg: Rules) -> bool:
    """Two props in different frames are the same object: the same track, which follows a prop however fast it
    moves, or without tracks the same prop at the same place."""
    if a.track is not None and b.track is not None:
        return a.track == b.track
    return a.key == b.key and box_iou(a.box, b.box) >= cfg.same_place


def carry(scenes: Sequence[Scene], shots: Sequence[int], cfg: Rules) -> list[Scene]:
    """A prop in no one's hand that touches a character who had the same object in their hand within cfg.carry
    frames of the same shot is in their hand too: a grip hides the fingers the hand model looks for. Still one of
    each prop per character. shots: each scene's shot; a hold never carries across a cut."""
    grow = np.ones((cfg.touch, cfg.touch), np.uint8)
    out = []
    for k, a in enumerate(scenes):
        own = list(a.own)
        holds = {(a.ids[o], p.key) for p, (o, how) in zip(a.props, a.own) if how == "hand"}
        for i, (p, (_, how)) in enumerate(zip(a.props, a.own)):
            if how == "hand":
                continue
            touch = cv2.dilate(p.mask.astype(np.uint8), grow) > 0
            for j in sorted(range(max(0, k - cfg.carry), min(len(scenes), k + cfg.carry + 1)), key=lambda j: abs(j - k)):
                if j == k or shots[j] != shots[k]:
                    continue
                b = scenes[j]
                holder = next((b.ids[o] for q, (o, hw) in zip(b.props, b.own)
                               if hw == "hand" and same_object(q, p, cfg)), None)
                here = [n for n, cid in enumerate(a.ids) if holder is not None and cid == holder]
                if here and (holder, p.key) not in holds and (touch & a.figures[here[0]].mask).any():
                    own[i] = (here[0], "carried")
                    holds.add((holder, p.key))
                    break
        out.append(replace(a, own=own))
    return out


def sliver(box: Sequence[int], cfg: Rules) -> bool:
    """A prop cut by the frame's edge to cfg.sliver px deep or less."""
    x0, y0, x1, y1 = box
    return (((y1 >= ANALYSIS_H - 1 or y0 <= 1) and y1 - y0 <= cfg.sliver)
            or ((x0 <= 1 or x1 >= ANALYSIS_W - 1) and x1 - x0 <= cfg.sliver))


def in_play(scenes: Sequence[Scene], listed: Sequence[Shot], cfg: Rules) -> list[Scene]:
    """Drops the props the shot list doesn't put in the scene: one it doesn't list, a loose copy of a prop it only
    puts in someone's hands (set dressing: a crucifix on the wall), and a sliver at the frame's edge. Runs after
    carry(), so a prop whose grip the hand model missed is back in hand first. listed: each scene's shot list
    entry."""
    out = []
    for a, shot in zip(scenes, listed):
        play = shot.play()
        props, own, rejected = [], [], list(a.rejected)
        for p, (o, how) in zip(a.props, a.own):
            if p.key not in play:
                rejected.append(Rejected(p, f"the shot list has no {p.key} in this shot"))
            elif play[p.key] == "held" and o is None:
                rejected.append(Rejected(p, "loose, and the shot list only has it in someone's hands: set dressing"))
            elif sliver(p.box, cfg):
                rejected.append(Rejected(p, "a sliver at the frame's edge"))
            else:
                props.append(p)
                own.append((o, how))
        out.append(replace(a, props=props, own=own, rejected=rejected))
    return out


def shot_of(cuts: Sequence[int], k: int) -> int:
    """Which run between cuts frame k is in, counting from 0."""
    return sum(1 for c in cuts if c <= k)
