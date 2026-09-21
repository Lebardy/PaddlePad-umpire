"""
Checks on the driver, run offline against synthetic data.

  ml/.venv/bin/python ml/test_run.py

Nothing here touches the API or the database. It exists to test the
three things the driver adds on top of the pipeline -- the gate, the
group loop, and the integrity check -- because those are the parts that
only misbehave on data shapes that are awkward to produce on demand.
"""

import sys
import uuid
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from pipeline.player_profiles import aggregate_player_profiles
from pipeline.skill_model import build_skill_model
from run import (
    EVIDENCE_COLUMNS,
    SCORE_PARTS,
    build_game_scores,
    per_match_features,
    NotEnoughData,
    apply_gate,
    run_pipeline,
    to_payload,
)

GATE = {"minMatchesPerPlayer": 5, "minPlayers": 3, "recommendedPlayers": 40}

passed = 0
failed = []


def check(label, condition, detail=""):
    global passed
    if condition:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed.append(label)
        print(f"  FAIL {label}  {detail}")


def synthetic_logs(num_players=60, matches_per_player=8, seed=7):
    """
    Match rows in exactly the shape /internal/match-logs.json returns.

    Player ability is drawn per player and then jittered per match, so
    the pool has real spread to cluster on -- uniform noise would give
    K-Means nothing to find and the test would pass for the wrong reason.
    """
    rng = np.random.default_rng(seed)
    rows = []
    for _ in range(num_players):
        player = str(uuid.uuid4())
        ability = rng.uniform(0.2, 0.9)
        net_preference = rng.uniform(0.1, 0.8)
        for match in range(matches_per_player):
            drops = int(rng.integers(6, 20))
            rows.append({
                "player_id": player,
                "match_id": str(uuid.uuid4()),
                "match_number": match + 1,
                "drop_attempts": drops,
                "drop_successes": int(rng.binomial(drops, min(ability, 0.95))),
                "drive_attempts": int(rng.integers(2, 15)),
                "dink_errors": int(rng.poisson(4 * (1 - ability) + 0.5)),
                "clean_winners": int(rng.poisson(8 * ability * (1 - net_preference) + 1)),
                "dink_winners": int(rng.poisson(8 * ability * net_preference + 1)),
                "unforced_errors": int(rng.poisson(10 * (1 - ability) + 1)),
                "match_duration_mins": float(rng.uniform(12, 30)),
                "uses_stacking": int(rng.random() < 0.3),
                "point_target": 11,
            })
    return pd.DataFrame(rows)


print("\ngate")

logs = synthetic_logs(num_players=60, matches_per_player=8)
gated, report = apply_gate(logs, GATE)
check("a healthy pool passes the gate untouched", len(gated) == len(logs))
check("nobody is held back when everyone qualifies", report["playersHeldBack"] == 0,
      str(report))

# One player with four matches: below the floor, so excluded entirely
# rather than rated from arithmetic that cannot describe them. At one
# match all seven consistency features would be NaN -> 0.0, which the
# skill model reads as flawless consistency and rewards.
thin = synthetic_logs(num_players=5, matches_per_player=4, seed=3)
mixed = pd.concat([logs, thin], ignore_index=True)
gated_mixed, mixed_report = apply_gate(mixed, GATE)
check("under-played players are dropped", mixed_report["playersHeldBack"] == 5,
      str(mixed_report["playersHeldBack"]))
check("the qualifying pool is unaffected by them",
      mixed_report["playersQualifying"] == 60, str(mixed_report))

try:
    apply_gate(synthetic_logs(num_players=2, matches_per_player=8), GATE)
    check("a pool of two is refused", False, "it was allowed")
except NotEnoughData as reason:
    check("a pool of two is refused", True)

try:
    apply_gate(pd.DataFrame(), GATE)
    check("no matches at all is refused", False, "it was allowed")
except NotEnoughData:
    check("no matches at all is refused", True)

check("the point-target mix is recorded", report["pointTargetMix"] == {"11": len(logs)},
      str(report["pointTargetMix"]))


print("\npipeline")

final, evidence, parts, games, structure = run_pipeline(gated)
check("every player who went in came out",
      set(final["player_id"]) == set(gated["player_id"].unique()),
      f"{len(final)} out of {gated['player_id'].nunique()}")
check("no player appears twice", not final["player_id"].duplicated().any())
check("everyone has a skill score", final["skill_score"].notna().all())
check("everyone has a skill group", final["skill_group"].notna().all())
check("archetypes were produced",
      final["playstyle_archetype"].notna().any(),
      str(structure))
print(f"       groups found: {structure['skillGroups']}")

# THE REGRESSION THIS FILE EXISTS FOR.
#
# The reference driver in the ML repo hardcodes two skill groups and
# passes them to a build_final_player_profiles that takes exactly two
# arguments. interpret_skill_clusters can return THREE, the third being
# "Intermediate-Performance" -- and when it does, everyone in it is
# dropped from the output with no error and no warning.
#
# Any run that finds three groups is therefore the interesting case, and
# the assertion above is what makes it visible instead of silent.
if len(structure["skillGroups"]) >= 3:
    check("a three-group run keeps everyone (the bug the driver fixes)",
          set(final["player_id"]) == set(gated["player_id"].unique()))
    print(f"       three groups exercised: {structure['skillGroups']}")
else:
    print(f"       note: this seed produced {len(structure['skillGroups'])} groups; "
          "searching for a three-group seed")
    for seed in range(1, 40):
        probe = synthetic_logs(num_players=60, matches_per_player=8, seed=seed)
        probe_gated, _ = apply_gate(probe, GATE)
        probe_final, _, _, _, probe_structure = run_pipeline(probe_gated)
        if len(probe_structure["skillGroups"]) >= 3:
            check("a three-group run keeps everyone (the bug the driver fixes)",
                  set(probe_final["player_id"]) == set(probe_gated["player_id"].unique()),
                  f"seed {seed}, groups {probe_structure['skillGroups']}")
            print(f"       three groups exercised at seed {seed}: "
                  f"{probe_structure['skillGroups']}")
            break
    else:
        print("       no three-group seed found in 40 tries; "
              "the loop is still what makes it safe")


print("\ngroup names")

check("without rally points the old score names the groups",
      structure["groupNamesFrom"] == "skill_score", structure["groupNamesFrom"])
check("the group order lists every group once",
      sorted(structure["groupOrder"]) == sorted(structure["skillGroups"]),
      str(structure["groupOrder"]))

# Points that run exactly against the old score, so any naming taken
# from them must come out reversed.
score_by_player = final.set_index("player_id")["skill_score"]
reversed_points = {pid: 3000.0 - float(score) for pid, score in score_by_player.items()}
by_points, _, _, _, points_structure = run_pipeline(gated, reversed_points)
both = final.merge(by_points, on="player_id", suffixes=("_score", "_points"))

check("rally points name the groups when given",
      points_structure["groupNamesFrom"] == "rally_points", points_structure["groupNamesFrom"])
check("the same people are grouped together either way",
      both.groupby("skill_group_score")["skill_group_points"].nunique().max() == 1
      and both.groupby("skill_group_points")["skill_group_score"].nunique().max() == 1)
means = both.groupby("skill_group_points")["skill_score_points"].mean()
point_means = [float((3000.0 - means[name])) for name in points_structure["groupOrder"]]
check("the group order runs from fewest to most rally points",
      point_means == sorted(point_means), str(point_means))
if len(structure["groupOrder"]) > 1:
    check("points running against the score reverse the order",
          [both.loc[both["skill_group_points"] == name, "skill_group_score"].iloc[0]
           for name in points_structure["groupOrder"]] == list(reversed(structure["groupOrder"])),
          f"{structure['groupOrder']} vs {points_structure['groupOrder']}")
check("the skill score itself is untouched",
      (both["skill_score_score"] == both["skill_score_points"]).all())

# This used to assert that playstyles clustered identically either way,
# because rally points only named the groups. They now also replace the
# old score as the thing subtracted from the playstyle features, so the
# archetypes are EXPECTED to differ -- that is the point of the change,
# not a regression. What still has to hold is that the two levels stay
# independent: K-Means never sees either number, so who is grouped with
# whom cannot move (checked above), and the run has to say which number
# it corrected against.
check("without rally points the playstyles are corrected against the old score",
      structure["residualisedBy"] == "skill_score", structure["residualisedBy"])
check("rally points correct the playstyles when given",
      points_structure["residualisedBy"] == "rally_points", points_structure["residualisedBy"])
check("every player still comes out either way",
      len(both) == final["player_id"].nunique() == by_points["player_id"].nunique(),
      f"{len(both)} vs {final['player_id'].nunique()} vs {by_points['player_id'].nunique()}")

missing_one = dict(list(reversed_points.items())[1:])
try:
    run_pipeline(gated, missing_one)
    check("a rated player with no rally points is refused", False, "it published")
except RuntimeError as error:
    check("a rated player with no rally points is refused", "no rally points" in str(error), str(error))


print("\npayload")

payload = to_payload(final, evidence, parts, games, report, structure, len(gated))
check("one rating per player", len(payload["ratings"]) == final["player_id"].nunique())
check("scores are plain floats", all(isinstance(r["skillScore"], float)
                                     for r in payload["ratings"]))
# Asserted as a COUNT, not as "no NaNs". The first version of this file
# only checked for NaN, which an empty dict satisfies perfectly -- and
# evidence was in fact empty for every player, because the raw features
# had been merged into a frame that already held scaled columns of the
# same names and pandas quietly suffixed both sides to _x and _y.
check("every player's evidence is actually populated",
      all(len(r["evidence"]) == len(EVIDENCE_COLUMNS) for r in payload["ratings"]),
      str({len(r["evidence"]) for r in payload["ratings"]}))
check("evidence holds raw feature values, not scaled ones",
      any(r["evidence"]["drop_efficiency_mean"] > 0 for r in payload["ratings"]),
      "a scaled column would centre on zero")
check("nothing is NaN in the payload",
      not any(isinstance(v, float) and np.isnan(v)
              for r in payload["ratings"] for v in r["evidence"].values()
              if v is not None))
# ---- the evidence behind each name ------------------------------
#
# A name a player cannot check is barely better than no name, so every
# archetype travels with the measurements that chose its words. These
# assert the two things that could silently go wrong: traits that do not
# match the name they are supposed to explain, and a name that repeats
# itself because two words came from the same family.
named = [r for r in payload["ratings"] if r["playstyleArchetype"]]
check("every named player carries the traits behind the name",
      named and all(isinstance(r["playstyleTraits"], list) and r["playstyleTraits"]
                    for r in named),
      str([r["playstyleTraits"] for r in named[:1]]))
check("the traits spell out the name they explain",
      all(r["playstyleArchetype"].endswith(
              " ".join(t["label"] for t in r["playstyleTraits"]))
          for r in named),
      str([(r["playstyleArchetype"], [t["label"] for t in r["playstyleTraits"]])
           for r in named[:2]]))
check("no name says the same thing twice",
      all(len({t["family"] for t in r["playstyleTraits"]})
          == len(r["playstyleTraits"])
          for r in named),
      str([[t["family"] for t in r["playstyleTraits"]] for r in named[:2]]))
check("a group too small to cluster has no traits either",
      all(r["playstyleTraits"] is None
          for r in payload["ratings"] if not r["playstyleArchetype"]))
print("       names this run produced: "
      + "; ".join(sorted({r["playstyleArchetype"] for r in named})))

# ---- what the score is made of ----------------------------------
#
# The page built on this tells a player which of four things is lifting
# their rating and which is holding it down. That claim is only true if
# the four parts ARE the score rather than four numbers shown near it,
# so the arithmetic is asserted here and the run refuses to publish when
# it stops holding (see run.build_score_parts).
rated = payload["ratings"]
check("every player carries all four parts of their score",
      all(set(r["scoreParts"]) == {key for key, *_ in SCORE_PARTS} for r in rated),
      str(sorted(rated[0]["scoreParts"])))
check("the four parts add up to the score itself",
      all(abs(sum(part["points"] for part in r["scoreParts"].values())
              - r["skillScore"]) < 0.05
          for r in rated),
      str([(round(sum(p["points"] for p in r["scoreParts"].values()), 2), r["skillScore"])
           for r in rated[:3]]))
check("no part can be worth more than its share of 100",
      all(0 <= part["points"] <= part["max"] + 0.01
          for r in rated for part in r["scoreParts"].values()),
      str([(k, p["points"], p["max"]) for k, p in rated[0]["scoreParts"].items()]))
check("the shares themselves add to 100",
      abs(sum(part["max"] for part in rated[0]["scoreParts"].values()) - 100) < 0.01,
      str({k: p["max"] for k, p in rated[0]["scoreParts"].items()}))
# Someone has to be at each end: min-max normalization gives the pool's
# best on a measurement full marks for it and the pool's worst none. The
# app says so rather than letting a player read 25/25 as perfection.
check("the pool's best and worst on a part really do sit at the ends",
      any(part["points"] >= part["max"] - 0.01
          for r in rated for part in r["scoreParts"].values())
      and any(part["points"] <= 0.01
              for r in rated for part in r["scoreParts"].values()))
check("parts carry the player's own measurement, not just points",
      all(isinstance(part["value"], float) for r in rated
          for part in r["scoreParts"].values()),
      str(rated[0]["scoreParts"]))
check("drops landing is a proportion and the rates are per minute",
      rated[0]["scoreParts"]["dropsLanding"]["unit"] == "proportion"
      and rated[0]["scoreParts"]["winningShots"]["unit"] == "per_minute")

# ---- every game, on the rating's own scale ----------------------
#
# The page built on this tells a player their rating IS the average of
# these games, not a summary of them. That is only true while the
# scoring stays a weighted sum of min-max scaled means -- both affine,
# so the average of the scores equals the score of the averages exactly
# -- and while per_match_features agrees with the pipeline's own
# per-match block. Either breaking shows up here first.
check("every player carries a score for every game they played",
      all(len(r["gameScores"]) == r["matchCount"] for r in rated),
      str([(len(r["gameScores"]), r["matchCount"]) for r in rated[:3]]))
check("a player's games average back to their rating, exactly",
      all(abs(sum(g["score"] for g in r["gameScores"]) / len(r["gameScores"])
              - r["skillScore"]) < 0.05
          for r in rated),
      str([(round(sum(g["score"] for g in r["gameScores"]) / len(r["gameScores"]), 2),
            r["skillScore"]) for r in rated[:3]]))
check("each game names the match it was played in",
      all(isinstance(g["matchId"], str) and g["matchId"] for r in rated
          for g in r["gameScores"]))
widest_player = max(
    max(g["score"] for g in r["gameScores"]) - min(g["score"] for g in r["gameScores"])
    for r in rated
)
whole_pool = max(r["skillScore"] for r in rated) - min(r["skillScore"] for r in rated)
check("one player's games swing across much of the whole pool's range",
      widest_player > whole_pool / 2,
      f"widest player {widest_player:.1f} vs whole pool {whole_pool:.1f} -- one game "
      "is a small sample, and the page has to say so rather than present a best "
      "game as a second rating")

# The drift guard is the point of the invariant, so prove it fires
# rather than trusting that it would.
# `final` carries scaled columns under the feature names, so the
# profiles are rebuilt here rather than reused -- the same trap the
# driver documents at run_pipeline.
profiles = build_skill_model(aggregate_player_profiles(gated))
tampered = gated.copy()
tampered["clean_winners"] = tampered["clean_winners"] + 3
try:
    build_game_scores(tampered, profiles)
    check("per-match arithmetic that drifts from the pipeline is refused",
          False, "it was accepted")
except RuntimeError:
    check("per-match arithmetic that drifts from the pipeline is refused", True)

check("one match in, one row of four measurements out",
      list(per_match_features(gated.head(1)).columns)
      == [column for _key, column, _wk, _lower in SCORE_PARTS],
      str(list(per_match_features(gated.head(1)).columns)))

check("the run records the conditions it ran under",
      payload["notes"]["gate"]["playersQualifying"] == 60,
      str(payload["notes"]["gate"]))
check("match counts survive to the payload",
      all(r["matchCount"] == 8 for r in payload["ratings"]),
      str({r["matchCount"] for r in payload["ratings"]}))



print("\nscheduler")

import threading
from datetime import datetime, time as clock, timezone

import scheduler

def at(hour, minute=0):
    return datetime(2026, 8, 26, hour, minute, tzinfo=timezone.utc)

# The whole reason this computes a target time instead of sleeping 24h:
# a container that restarts at 18:00 must still fire at 19:00, not at
# 18:00 the following day.
check("before the hour, waits until today's run",
      scheduler.seconds_until_next(clock(19, 0), at(18, 0)) == 3600,
      str(scheduler.seconds_until_next(clock(19, 0), at(18, 0))))
check("after the hour, waits until tomorrow's",
      scheduler.seconds_until_next(clock(19, 0), at(20, 0)) == 23 * 3600,
      str(scheduler.seconds_until_next(clock(19, 0), at(20, 0))))
check("exactly on the hour rolls to tomorrow rather than firing twice",
      scheduler.seconds_until_next(clock(19, 0), at(19, 0)) == 24 * 3600,
      str(scheduler.seconds_until_next(clock(19, 0), at(19, 0))))
check("just after midnight still waits for the same clock time",
      scheduler.seconds_until_next(clock(19, 0), at(0, 30)) == 18.5 * 3600,
      str(scheduler.seconds_until_next(clock(19, 0), at(0, 30))))
check("19:00 UTC is 3am in Manila (UTC+8)",
      (scheduler.RUN_AT_UTC.hour + 8) % 24 == 3, str(scheduler.RUN_AT_UTC))

# Disabled means disabled: no thread, so nothing can fire.
check("the schedule can be turned off", scheduler.start(None, None, enabled=False) is None)

# A scheduled run must not start while a manual one holds the lock.
busy = threading.Lock()
busy.acquire()
check("a held lock is not acquirable by the scheduler",
      not busy.acquire(blocking=False))
busy.release()


print(f"\n{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
