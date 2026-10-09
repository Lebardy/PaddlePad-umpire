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

from pipeline.clustering import (
    PLAYSTYLE_CLUSTERING_FEATURES,
    TRAIT_DESCRIPTORS,
    cluster_playstyles,
    describe_playstyle_name,
    test_playstyle_k_values,
    test_playstyle_stability,
)
from pipeline.feature_engineering import (
    PLAYSTYLE_FEATURES,
    extract_playstyle_components,
)
from run import (
    EVIDENCE_COLUMNS,
    name_skill_groups,
    NotEnoughData,
    apply_gate,
    run_pipeline,
    to_payload,
)

import run as driver

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
    # Ids get their own fixed stream so every run is identical without
    # changing the numbers the players themselves are drawn from.
    id_rng = np.random.default_rng([seed, 1])

    def new_id():
        return str(uuid.UUID(bytes=id_rng.bytes(16), version=4))

    rows = []
    for _ in range(num_players):
        player = new_id()
        ability = rng.uniform(0.2, 0.9)
        net_preference = rng.uniform(0.1, 0.8)
        for match in range(matches_per_player):
            drops = int(rng.integers(6, 20))
            rows.append({
                "player_id": player,
                "match_id": new_id(),
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


def synthetic_points(logs):
    """
    Rally points for every player in the logs, as /internal/match-logs.json
    sends them: player id to points.

    Built from the share of a player's drops that landed, which follows
    the ability the logs were drawn from, so better players hold more
    points -- from 1000 for no drop landed to 2000 for every one.
    """
    totals = logs.groupby("player_id")[["drop_successes", "drop_attempts"]].sum()
    share = totals["drop_successes"] / totals["drop_attempts"]
    return {player: 1000.0 + 1000.0 * float(value) for player, value in share.items()}


print("\ngate")

logs = synthetic_logs(num_players=60, matches_per_player=8)
gated, report = apply_gate(logs, GATE)
check("a healthy pool passes the gate untouched", len(gated) == len(logs))
check("nobody is held back when everyone qualifies", report["playersHeldBack"] == 0,
      str(report))

# Five players with four matches each: below the floor, so excluded
# entirely rather than grouped from arithmetic that cannot describe
# them. At one match all seven consistency features would be NaN -> 0.0,
# which K-Means reads as flawless consistency.
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

points = synthetic_points(gated)
final, evidence, structure = run_pipeline(gated, points)
check("every player who went in came out",
      set(final["player_id"]) == set(gated["player_id"].unique()),
      f"{len(final)} out of {gated['player_id'].nunique()}")
check("no player appears twice", not final["player_id"].duplicated().any())
check("everyone has a skill group", final["skill_group"].notna().all())
check("archetypes were produced",
      final["playstyle_archetype"].notna().any(),
      str(structure))
extraction = structure.get("styleExtraction") or {}
check("the run says the styles were found on boiled-down scores",
      extraction.get("method") == "pca", str(extraction))
check("and how many components carried how much of the spread",
      extraction.get("components", 0) >= 1 and extraction.get("spreadKept", 0) >= 0.80,
      str(extraction))
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
        probe_final, _, probe_structure = run_pipeline(
            probe_gated, synthetic_points(probe_gated))
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

check("rally points name the groups",
      structure["groupNamesFrom"] == "rally_points", structure["groupNamesFrom"])
check("the group order lists every group once",
      sorted(structure["groupOrder"]) == sorted(structure["skillGroups"]),
      str(structure["groupOrder"]))
group_points = final["player_id"].map(points).groupby(final["skill_group"]).mean()
point_means = [float(group_points[name]) for name in structure["groupOrder"]]
check("the group order runs from fewest to most rally points",
      point_means == sorted(point_means), str(point_means))

# The same points turned upside down, so any naming taken from them
# must come out reversed.
reversed_points = {pid: 3000.0 - value for pid, value in points.items()}
by_reversed, _, reversed_structure = run_pipeline(gated, reversed_points)
both = final.merge(by_reversed, on="player_id", suffixes=("_plain", "_reversed"))

check("reversed points still name the groups",
      reversed_structure["groupNamesFrom"] == "rally_points",
      reversed_structure["groupNamesFrom"])
# K-Means never sees the points, so who is grouped with whom cannot
# move with them.
check("the skill clusters are the same whatever the points say",
      (both["skill_cluster_plain"] == both["skill_cluster_reversed"]).all())
check("the same people are grouped together either way",
      both.groupby("skill_group_plain")["skill_group_reversed"].nunique().max() == 1
      and both.groupby("skill_group_reversed")["skill_group_plain"].nunique().max() == 1)
if len(structure["groupOrder"]) > 1:
    check("reversed points reverse the order",
          [both.loc[both["skill_group_reversed"] == name, "skill_group_plain"].iloc[0]
           for name in reversed_structure["groupOrder"]] == list(reversed(structure["groupOrder"])),
          f"{structure['groupOrder']} vs {reversed_structure['groupOrder']}")

# The points are also what is subtracted from the playstyle features, so
# the archetypes of the two runs may differ. What has to hold is that
# the run says what it corrected against, and that nobody is lost.
check("the playstyles are corrected against rally points",
      structure["residualisedBy"] == "rally_points"
      and reversed_structure["residualisedBy"] == "rally_points",
      f"{structure['residualisedBy']} {reversed_structure['residualisedBy']}")
check("every player still comes out either way",
      len(both) == final["player_id"].nunique() == by_reversed["player_id"].nunique(),
      f"{len(both)} vs {final['player_id'].nunique()} vs {by_reversed['player_id'].nunique()}")

missing_one = dict(list(points.items())[1:])
try:
    run_pipeline(gated, missing_one)
    check("a rated player with no rally points is refused", False, "it published")
except RuntimeError as error:
    check("a rated player with no rally points is refused", "no rally points" in str(error), str(error))


print("\ngroup names only when the order is clear")

def named(points_by_cluster, seed=5):
    """Name hand-made skill clusters whose players have the given rally
    points. Returns the names by cluster, the order, the source and the
    gaps name_skill_groups reports."""
    rows, points = [], {}
    for cluster, values in points_by_cluster.items():
        for i, value in enumerate(values):
            pid = f"c{cluster}-{i}"
            rows.append({"player_id": pid, "skill_cluster": cluster})
            points[pid] = float(value)
    labelled, order, source, gaps = name_skill_groups(pd.DataFrame(rows), points)
    names = labelled.groupby("skill_cluster")["skill_group"].first().to_dict()
    return names, order, source, gaps

gap_rng = np.random.default_rng(3)
spread = lambda centre, n=10: centre + gap_rng.normal(scale=10, size=n)

names, order, source, gaps = named({0: spread(1400), 1: spread(1600)})
check("groups far apart on points keep their level names",
      names == {0: "Developing / Lower-Performance", 1: "Higher-Performance"}
      and order == ["Developing / Lower-Performance", "Higher-Performance"] and source == "rally_points",
      f"{names} {order} {source}")
check("and the gap between them is recorded as clear",
      len(gaps) == 1 and gaps[0]["clear"] and gaps[0]["gap"] > gaps[0]["needed"], str(gaps))

names, order, source, gaps = named({0: spread(1500, 12), 1: spread(1502, 8)})
check("groups level on points get neutral letters, biggest first, and no order",
      names == {0: "Group A", 1: "Group B"} and order is None and source == "neutral",
      f"{names} {order} {source}")
check("and the gap is recorded as not clear", len(gaps) == 1 and not gaps[0]["clear"], str(gaps))

names, order, source, gaps = named({0: spread(1400, 19), 1: [1900.0]})
check("a group of one player can never show a clear gap",
      source == "neutral" and names == {0: "Group A", 1: "Group B"} and not gaps[0]["clear"], f"{names} {gaps}")

names, order, source, gaps = named({0: spread(1300), 1: spread(1500), 2: spread(1502)})
check("one unclear gap among clear ones makes every group neutral",
      source == "neutral" and sorted(names.values()) == ["Group A", "Group B", "Group C"]
      and [g["clear"] for g in gaps] == [True, False], f"{names} {[g['clear'] for g in gaps]}")

print("\nstyle K-Means on chosen columns")

# Twenty players whose two extra columns split them cleanly in half, while
# the thirteen measurements are noise that splits them some other way.
# Pointed at the extra columns, the style K-Means has to find the halves.
column_rng = np.random.default_rng(11)
halves = np.repeat([0, 1], 10)
columns_frame = pd.DataFrame(
    column_rng.normal(size=(20, len(PLAYSTYLE_CLUSTERING_FEATURES))),
    columns=PLAYSTYLE_CLUSTERING_FEATURES,
)
columns_frame.insert(0, "player_id", [f"p{i}" for i in range(20)])
columns_frame["skill_group"] = "Everyone"
columns_frame["pc_1"] = np.where(halves == 0, -5.0, 5.0) + column_rng.normal(scale=0.1, size=20)
columns_frame["pc_2"] = column_rng.normal(scale=0.1, size=20)

chosen_data, chosen_k, _ = test_playstyle_k_values(
    columns_frame, "Everyone", features=["pc_1", "pc_2"])
by_columns, _, _ = cluster_playstyles(chosen_data, chosen_k, features=["pc_1", "pc_2"])
by_default, _, _ = cluster_playstyles(chosen_data, 2)
by_measurements, _, _ = cluster_playstyles(chosen_data, 2, features=PLAYSTYLE_CLUSTERING_FEATURES)

check("pointed at other columns, the style K-Means picks the split they show",
      chosen_k == 2, f"k={chosen_k}")
check("and puts each half in a style of its own",
      by_columns["playstyle_cluster"].nunique() == 2
      and by_columns.groupby(halves)["playstyle_cluster"].nunique().max() == 1,
      str(by_columns["playstyle_cluster"].tolist()))
check("left alone, it still clusters on the thirteen measurements",
      (by_default["playstyle_cluster"] == by_measurements["playstyle_cluster"]).all())

# The stability check has to test the same setup: pointed at the extra
# columns, every seed should find the halves; left alone, it should match
# being handed the thirteen measurements.
stable_columns = test_playstyle_stability(
    columns_frame, "Everyone", features=["pc_1", "pc_2"])
stable_default = test_playstyle_stability(columns_frame, "Everyone")
stable_measurements = test_playstyle_stability(
    columns_frame, "Everyone", features=PLAYSTYLE_CLUSTERING_FEATURES)

check("the stability check, pointed at other columns, finds the halves on every seed",
      all(run["k"] == 2
          and pd.Series(run["labels"]).groupby(halves).nunique().max() == 1
          for run in stable_columns.values()),
      str({seed: run["k"] for seed, run in stable_columns.items()}))
check("left alone, the stability check still uses the thirteen measurements",
      all(stable_default[seed]["k"] == stable_measurements[seed]["k"]
          and (stable_default[seed]["labels"] == stable_measurements[seed]["labels"]).all()
          for seed in stable_default))


print("\nboil-down step")

# Thirteen measurements where twelve move together and one moves on its
# own: the first component carries about twelve thirteenths of the spread
# (about 0.92), so 80% needs one component and 97% needs two.
spread_rng = np.random.default_rng(5)
shared = spread_rng.normal(size=40)
measurements = np.column_stack(
    [shared + spread_rng.normal(scale=0.01, size=40) for _ in range(12)]
    + [spread_rng.normal(size=40)]
)
measurements = (measurements - measurements.mean(axis=0)) / measurements.std(axis=0)
boil_frame = pd.DataFrame(measurements, columns=PLAYSTYLE_FEATURES)
boil_frame.insert(0, "player_id", [f"p{i}" for i in range(40)])

one_kept, _, one_share = extract_playstyle_components(boil_frame)
two_kept, _, two_share = extract_playstyle_components(boil_frame, min_share=0.97)
check("the boil-down keeps the fewest components that reach 80% of the spread",
      list(one_kept.columns) == ["player_id", "pc_1"] and one_share >= 0.80,
      f"{list(one_kept.columns)}, {one_share:.3f}")
check("asking for more of the spread keeps more components",
      list(two_kept.columns) == ["player_id", "pc_1", "pc_2"] and two_share >= 0.97,
      f"{list(two_kept.columns)}, {two_share:.3f}")
check("every player keeps their place and gets a score",
      one_kept["player_id"].tolist() == boil_frame["player_id"].tolist()
      and np.isfinite(two_kept[["pc_1", "pc_2"]].to_numpy()).all())


print("\nthe driver clusters styles on the boiled-down scores")

# Replace the boil-down with one planted score that splits players by
# alternate rows. If the style K-Means really runs on the scores, every
# style inside a skill group is one side of that split; if it ran on the
# thirteen measurements instead, the planted split would not show.
planted_side = {}


def planted_components(scaled):
    side = np.arange(len(scaled)) % 2
    planted_side.update(zip(scaled["player_id"], side))
    jitter = np.random.default_rng(3).normal(scale=0.01, size=len(scaled))
    planted = pd.DataFrame({"player_id": scaled["player_id"].to_numpy(),
                            "pc_1": np.where(side == 0, -10.0, 10.0) + jitter})
    return planted, None, 1.0


real_extract = getattr(driver, "extract_playstyle_components", None)
driver.extract_playstyle_components = planted_components
try:
    planted_final, _, _ = run_pipeline(gated, points)
finally:
    driver.extract_playstyle_components = real_extract

clustered_rows = planted_final[planted_final["playstyle_cluster"].notna()]
mixed_groups = [rows for _, rows in clustered_rows.groupby("skill_group")
                if rows["player_id"].map(planted_side).nunique() == 2]
check("the style groups follow the boiled-down scores, not the raw measurements",
      bool(mixed_groups) and all(
          rows["playstyle_cluster"].nunique() == 2
          and rows.groupby(rows["player_id"].map(planted_side))["playstyle_cluster"].nunique().max() == 1
          for rows in mixed_groups),
      str([rows.groupby(rows["player_id"].map(planted_side))["playstyle_cluster"].unique().tolist()
           for rows in mixed_groups]))
check("and the styles still get names",
      clustered_rows["playstyle_archetype"].notna().all(),
      str(clustered_rows["playstyle_archetype"].unique().tolist()))


print("\nplaystyle words")

def words_for(**differences):
    """The name's describing words for a style that differs from its
    group's average only where given (in standard deviations)."""
    profile = pd.Series(0.0, index=PLAYSTYLE_CLUSTERING_FEATURES)
    for feature, z in differences.items():
        profile[feature] = z
    return [part["label"] for part in describe_playstyle_name(profile)
            if part["family"] != "identity"]

every_word = {word for pair in TRAIT_DESCRIPTORS.values() for word in pair}
check("the stinging words are gone",
      not every_word & {"Raw", "Error-Prone", "Erratic", "Volatile", "Shaky-Net"},
      str(sorted(w for w in every_word if w)))
check("Inconsistent and Streaky stay",
      {"Inconsistent", "Streaky"} <= every_word)
check("changing a lot from match to match in attack, mistakes or net play reads Unpredictable",
      [words_for(aggression_std=1.0), words_for(general_error_rate_std=1.0),
       words_for(dink_error_rate_std=1.0)] == [["Unpredictable"]] * 3,
      str([words_for(aggression_std=1.0), words_for(general_error_rate_std=1.0),
           words_for(dink_error_rate_std=1.0)]))
check("two of those at once still say Unpredictable only once",
      words_for(aggression_std=1.0, dink_error_rate_std=0.9) == ["Unpredictable"],
      str(words_for(aggression_std=1.0, dink_error_rate_std=0.9)))
check("a style most set apart by more mistakes per winner gets the next difference's word instead",
      words_for(error_to_winner_ratio=1.5, winner_rate_std=-0.4) == ["Consistent"],
      str(words_for(error_to_winner_ratio=1.5, winner_rate_std=-0.4)))
check("and so does one most set apart by fewer drops landing",
      words_for(drop_efficiency_mean=-1.5, drop_efficiency_std=0.6) == ["Inconsistent"],
      str(words_for(drop_efficiency_mean=-1.5, drop_efficiency_std=0.6)))
check("the share of finishes that are winners shapes the styles but is never a word",
      "aggression_mean" in PLAYSTYLE_CLUSTERING_FEATURES
      and not every_word & {"Patient", "Aggressive"}
      and words_for(aggression_mean=2.0, winner_rate_std=0.5) == ["Streaky"]
      and words_for(aggression_mean=-2.0) == [],
      str([words_for(aggression_mean=2.0, winner_rate_std=0.5), words_for(aggression_mean=-2.0)]))
check("the other side of those two keeps its word",
      [words_for(error_to_winner_ratio=-1.0), words_for(drop_efficiency_mean=1.0)]
      == [["Clean"], ["Precise"]])
check("a style set apart only where there is no word gets none",
      words_for(error_to_winner_ratio=1.5, drop_efficiency_mean=-1.0) == [],
      str(words_for(error_to_winner_ratio=1.5, drop_efficiency_mean=-1.0)))


print("\npayload")

payload = to_payload(final, evidence, report, structure, len(gated))
check("one rating per player", len(payload["ratings"]) == final["player_id"].nunique())
check("a rating carries the group, the playstyle and what is behind it, and nothing else",
      all(set(r) == {"playerId", "skillGroup", "playstyleCluster", "playstyleArchetype",
                     "playstyleTraits", "evidence", "matchCount"}
          for r in payload["ratings"]),
      str(sorted(payload["ratings"][0])))
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

check("the run records the conditions it ran under",
      payload["notes"]["gate"]["playersQualifying"] == 60,
      str(payload["notes"]["gate"]))
check("match counts survive to the payload",
      all(r["matchCount"] == 8 for r in payload["ratings"]),
      str({r["matchCount"] for r in payload["ratings"]}))



print("\nthe door to POST /run")

import os

os.environ["INTERNAL_API_KEY"] = "k" * 40
import service

# The pipeline itself needs the API; only the door in front of it is
# under test here, so the run is swapped for one that says what it was
# asked to do.
service.run = lambda publish=True: {"published": publish}
door = service.app.test_client()

check("no key is refused", door.post("/run").status_code == 401)
check("a wrong key is refused",
      door.post("/run", headers={"x-internal-key": "w" * 40}).status_code == 401)
check("a key with a letter outside plain English is refused, not a crash",
      door.post("/run", headers={"x-internal-key": "é" + "k" * 39}).status_code == 401)
opened = door.post("/run?dry=1", headers={"x-internal-key": "k" * 40})
check("the right key gets through, and ?dry=1 asks for a dry run",
      opened.status_code == 200 and opened.get_json() == {"published": False},
      f"{opened.status_code} {opened.get_data(as_text=True)[:80]}")


print(f"\n{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
