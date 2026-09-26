"""The shot list sent with each video: every shot's cast, each found by a plain description, and its props with who
holds them. parse() checks all of it and raises ShotListError listing every problem it found."""
import json
import math
from dataclasses import dataclass
from typing import Any

CAST_IDS = ("A", "B", "C", "D")
SIDES = ("left", "center", "right")
MAX_WORDS = 8
LOOSE = "loose"


@dataclass(frozen=True)
class CastMember:
    id: str
    name: str
    find: str               # what SAM searches for
    side: str | None        # where they start: left, center or right; needed only by members who share a find


def same_find(find: str) -> str:
    """A find phrase compared as SAM reads it: case and spacing don't count."""
    return " ".join(find.lower().split())


@dataclass(frozen=True)
class PropSpec:
    find: str
    holder: str     # a cast id, or LOOSE


@dataclass(frozen=True)
class Shot:
    start_s: float
    end_s: float
    cast: tuple[CastMember, ...]
    props: tuple[PropSpec, ...]

    def held(self) -> set[str]:
        """The find phrases of the props the shot puts in someone's hands: each with a copy that has a holder."""
        return {p.find for p in self.props if p.holder != LOOSE}

    def play(self) -> dict[str, str]:
        """Each prop's find phrase: "held" when every copy the shot lists has a holder, so a loose copy is set
        dressing; "loose" when a loose copy is part of the scene."""
        out: dict[str, str] = {}
        for p in self.props:
            out[p.find] = "loose" if p.holder == LOOSE or out.get(p.find) == "loose" else "held"
        return out


@dataclass(frozen=True)
class ShotList:
    shots: tuple[Shot, ...]

    def at(self, t: float) -> Shot:
        """The shot playing at t seconds, or the nearest one where the list leaves a gap."""
        return min(self.shots, key=lambda s: 0.0 if s.start_s <= t < s.end_s else min(abs(t - s.start_s),
                                                                                         abs(t - s.end_s)))


class ShotListError(ValueError):
    def __init__(self, problems: list[str]):
        super().__init__("bad shot list: " + "; ".join(problems))
        self.problems = problems


def _phrase(value: Any, where: str, problems: list[str]) -> str:
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where} must be a non-empty string")
        return ""
    if len(value.split()) > MAX_WORDS:
        problems.append(f"{where} has {len(value.split())} words; at most {MAX_WORDS}")
    return value.strip()


def _seconds(value: Any, where: str, problems: list[str]) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        problems.append(f"{where} must be a number of seconds, 0 or more")
        return 0.0
    return float(value)


def _cast(raw: Any, where: str, problems: list[str]) -> tuple[CastMember, ...]:
    if not isinstance(raw, list):
        problems.append(f"{where} must be a list")
        return ()
    if len(raw) > len(CAST_IDS):
        problems.append(f"{where} has {len(raw)} members; at most {len(CAST_IDS)}")
    out, ids = [], set()
    for i, c in enumerate(raw):
        at = f"{where}[{i}]"
        if not isinstance(c, dict):
            problems.append(f"{at} must be an object")
            continue
        cid = c.get("id")
        if cid not in CAST_IDS:
            problems.append(f"{at}.id must be one of {', '.join(CAST_IDS)}")
        elif cid in ids:
            problems.append(f"{at}.id {cid} appears twice in the shot")
        ids.add(cid)
        name = c.get("name")
        if not isinstance(name, str) or not name.strip():
            problems.append(f"{at}.name must be a non-empty string")
        find = _phrase(c.get("find"), f"{at}.find", problems)
        side = c.get("side")
        if side is not None and side not in SIDES:
            problems.append(f"{at}.side must be one of {', '.join(SIDES)}, or left out")
        out.append(CastMember(str(cid), str(name), find, side if side in SIDES else None))
    # members who share a find are told apart only by where they start
    groups: dict[str, list[CastMember]] = {}
    for m in out:
        if m.find:
            groups.setdefault(same_find(m.find), []).append(m)
    for members in groups.values():
        if len(members) > 1 and any(m.side is None for m in members):
            problems.append(f"{where}: {' and '.join(m.id for m in members)} share the find {members[0].find!r}, so "
                            f"each needs a side ({', '.join(SIDES)})")
    return tuple(out)


def _props(raw: Any, cast: tuple[CastMember, ...], where: str, problems: list[str]) -> tuple[PropSpec, ...]:
    if not isinstance(raw, list):
        problems.append(f"{where} must be a list")
        return ()
    ids = {c.id for c in cast}
    out = []
    for i, p in enumerate(raw):
        at = f"{where}[{i}]"
        if not isinstance(p, dict):
            problems.append(f"{at} must be an object")
            continue
        find = _phrase(p.get("find"), f"{at}.find", problems)
        holder = p.get("holder")
        if holder != LOOSE and holder not in ids:
            problems.append(f"{at}.holder must be \"{LOOSE}\" or an id in the shot's cast ({', '.join(sorted(ids))})")
        out.append(PropSpec(find, str(holder)))
    return tuple(out)


def parse(data: str | bytes | dict) -> ShotList:
    """The shot list from its JSON text, or already decoded; raises ShotListError."""
    if isinstance(data, (str, bytes)):
        try:
            data = json.loads(data)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            raise ShotListError([f"not JSON: {e}"]) from e
    raw = data.get("shots") if isinstance(data, dict) else None
    if not isinstance(raw, list) or not raw:
        raise ShotListError(["must be an object with a non-empty \"shots\" list"])
    problems: list[str] = []
    shots, end = [], 0.0
    for i, s in enumerate(raw):
        at = f"shots[{i}]"
        if not isinstance(s, dict):
            problems.append(f"{at} must be an object")
            continue
        start_s = _seconds(s.get("start_s"), f"{at}.start_s", problems)
        end_s = _seconds(s.get("end_s"), f"{at}.end_s", problems)
        if end_s <= start_s:
            problems.append(f"{at} ends at {end_s} s, not after its start at {start_s} s")
        if start_s < end - 1e-6:
            problems.append(f"{at} starts at {start_s} s, before the shot before it ends at {end} s")
        end = max(end, end_s)
        cast = _cast(s.get("cast"), f"{at}.cast", problems)
        props = _props(s.get("props", []), cast, f"{at}.props", problems)
        shots.append(Shot(start_s, end_s, cast, props))
    if problems:
        raise ShotListError(problems)
    return ShotList(tuple(shots))
