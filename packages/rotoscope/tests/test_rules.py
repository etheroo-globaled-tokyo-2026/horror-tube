from dataclasses import replace

from kit import A_HAND, A_MASK, B_MASK, KNIFE, find, rect, shot

from rotoscope import rules
from rotoscope.config import Rules

CFG = Rules()


def scenes(frames, listed, hands=None, runs=None, sam_hands=None):
    """The rules from finds to scenes, as the pipeline runs them: every frame keeps its finds, then who holds what,
    the carry-over and the props in play. listed: one shot list entry for every frame, or one per frame."""
    n = len(frames)
    listed = listed if isinstance(listed, list) else [listed] * n
    runs = runs or [0] * n
    kept = rules.decisions(frames, runs, CFG)
    got = [rules.assign(kept[k], (hands or [[]] * n)[k], (sam_hands or [[]] * n)[k], listed[k], CFG)
           for k in range(n)]
    return rules.in_play(rules.carry(got, runs, CFG), listed, CFG)


def held(scene):
    """Each prop's key and holder (None: loose)."""
    return [(p.key, scene.holder(i)) for i, p in enumerate(scene.props)]


def test_a_hand_on_a_prop_holds_it_only_when_the_shot_list_says_it_is_held():
    frame = [find("cast", "A", A_MASK), find("prop", "knife", KNIFE)]
    in_hand = scenes([frame], shot(props=(("knife", "A"),)), hands=[[A_HAND]])[0]
    on_table = scenes([frame], shot(props=(("knife", "loose"),)), hands=[[A_HAND]])[0]
    assert held(in_hand) == [("knife", "A")]
    assert held(on_table) == [("knife", None)]


def test_a_held_prop_with_no_hand_on_it_is_set_dressing():
    frame = [find("cast", "A", A_MASK), find("prop", "knife", KNIFE)]
    assert held(scenes([frame], shot(props=(("knife", "A"),)))[0]) == []


def test_a_prop_held_against_the_body_is_the_holders():
    body = A_MASK & ~rect(130, 150, 190, 200)
    frame = [find("cast", "A", body), find("prop", "book", rect(130, 150, 190, 200))]
    assert held(scenes([frame], shot(props=(("book", "A"),)))[0]) == [("book", "A")]


def test_a_hold_carries_over_a_hidden_grip_but_never_across_a_cut():
    touching = rect(221, 200, 261, 215)
    frames = [[find("cast", "A", A_MASK), find("prop", "knife", touching, track=3)]] * 2
    listed = shot(props=(("knife", "A"),))
    one_shot = scenes(frames, listed, hands=[[A_HAND], []])
    across = scenes(frames, listed, hands=[[A_HAND], []], runs=[0, 1])
    assert held(one_shot[1]) == [("knife", "A")] and one_shot[1].own[0][1] == "carried"
    assert held(across[1]) == []


def test_set_dressing_unlisted_props_and_slivers_are_dropped():
    frame = [find("cast", "A", A_MASK), find("prop", "knife", KNIFE),
             find("prop", "knife", rect(560, 40, 600, 60), score=0.8),       # a second knife, loose on a wall
             find("prop", "lamp", rect(300, 40, 340, 90)),                   # the shot list has no lamp
             find("prop", "coin", rect(300, 350, 330, 360))]                 # cut to 10 px by the bottom edge
    listed = shot(props=(("knife", "A"), ("coin", "loose")))
    assert held(scenes([frame], listed, hands=[[A_HAND]])[0]) == [("knife", "A")]


def test_a_figure_inside_a_prop_is_not_a_character():
    frame = [find("cast", "A", A_MASK), find("prop", "crucifix", rect(400, 40, 520, 320)),
             find("cast", "B", rect(430, 80, 490, 300), score=0.95)]
    got = scenes([frame], shot(props=(("crucifix", "loose"),)))[0]
    assert got.ids == ["A"]


def test_two_descriptions_on_one_person_leave_the_other_to_the_second():
    frame = [find("cast", "A", A_MASK, 0.9), find("cast", "A", B_MASK, 0.3),
             find("cast", "B", A_MASK, 0.8), find("cast", "B", B_MASK, 0.7)]
    got = scenes([frame], shot())[0]
    assert sorted(zip(got.ids, (f.box[0] for f in got.figures))) == [("A", 100), ("B", 420)]


def test_cast_who_share_a_description_are_told_apart_by_side():
    suits = {"A": "man in a black suit", "B": "man in a black suit"}
    frame = [find("cast", "A", B_MASK, 0.9), find("cast", "A", A_MASK, 0.8),
             find("cast", "B", B_MASK, 0.9), find("cast", "B", A_MASK, 0.8)]
    a_left = shot(finds=suits)
    a_right = replace(a_left, cast=tuple(replace(c, side=s) for c, s in zip(a_left.cast, ("right", "left"))))
    for listed, left, right in ((a_left, "A", "B"), (a_right, "B", "A")):
        got = scenes([frame], listed)[0]
        assert sorted(zip((f.box[0] for f in got.figures), got.ids)) == [(100, left), (420, right)]


def test_a_weak_prop_stays_only_beside_a_sure_one_in_the_same_shot():
    sure, weak = find("prop", "knife", KNIFE, 0.6), find("prop", "knife", KNIFE, 0.3)
    listed = shot(props=(("knife", "A"),))
    frames = [[find("cast", "A", A_MASK), sure], [find("cast", "A", A_MASK), weak]]
    same_shot = scenes(frames, listed, hands=[[A_HAND]] * 2)
    after_cut = scenes(frames, listed, hands=[[A_HAND]] * 2, runs=[0, 1])
    assert held(same_shot[1]) == [("knife", "A")]
    assert held(after_cut[1]) == []


def test_a_tracker_fill_in_is_kept_until_it_shrinks_or_a_cut_parts_it_from_its_sighting():
    listed = shot(props=(("knife", "A"),))
    seen = [find("cast", "A", A_MASK), find("prop", "knife", KNIFE, track=5)]
    filled = [find("cast", "A", A_MASK), find("prop", "knife", KNIFE, score=0.9, track=5, fill=True)]
    shrunk = [find("cast", "A", A_MASK), find("prop", "knife", rect(222, 200, 230, 204), track=5, fill=True)]
    hands = [[A_HAND]] * 3
    got = scenes([seen, filled, shrunk], listed, hands=hands)
    cut = scenes([seen, filled, shrunk], listed, hands=hands, runs=[0, 1, 1])
    assert [held(s) for s in got] == [[("knife", "A")], [("knife", "A")], []]
    assert held(cut[1]) == []
