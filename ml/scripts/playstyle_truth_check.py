"""
Does the old skill score or the rally rating give K-Means better results,
judged against the simulated pool's hidden truth?

    INTERNAL_API_KEY=... .venv/bin/python scripts/playstyle_truth_check.py \
        https://api-staging-8ac6.up.railway.app \
        ../server/scripts/.rally-points.json ../server/scripts/.sim-pool-truth.json

Read-only, and changes nothing in the pipeline. Only possible on the
synthetic pool, whose players each have a hidden ability and a hidden
habit of playing at the net, written down when it was seeded.

For each version (A: the old score, B: rally points in its place), and
for several K-Means random starts, it asks three things of the simulated
players:

  group order   do higher-numbered skill groups hold players with higher
                hidden ability? (Spearman of group number with ability)
  net habit     inside each skill group, how much of the spread in the
                hidden net habit do the playstyles account for? Higher
                means the styles found a real difference in how people
                play. (Between-style share of the spread, pooled.)
  ability leak  the same share for hidden ability. LOWER is better: the
                score is there to take skill out of playstyles, so a
                style that just sorts players by skill has failed.

Both shares are printed beside what shuffling the style labels at random
inside each group would score, since small groups score above zero by
chance alone.

The hidden drop-shot preference is not checked: the simulator records
no third shots, so nothing in the data reflects it.
"""

import contextlib
import io
import json
import os
import re
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import run  # noqa: E402

warnings.filterwarnings("ignore")

MIN_MATCHES = 5
SEEDS = [42, 0, 1, 2, 3, 4, 5, 6, 7, 8]
SHUFFLES = 200

api = sys.argv[1].rstrip("/")
rally_points = json.loads(Path(sys.argv[2]).read_text())
truth = pd.DataFrame(json.loads(Path(sys.argv[3]).read_text())["players"])[
    ["id", "ability", "netPlay"]
].rename(columns={"id": "player_id"})
key = os.environ["INTERNAL_API_KEY"]

# The same door run.py uses. The umpire-facing CSV download this script
# used to read was removed: it showed every facility's matches to any
# signed-in umpire, while the app itself scopes an umpire to one.
response = requests.get(f"{api}/internal/match-logs.json", headers={"x-internal-key": key}, timeout=60)
response.raise_for_status()
rows = pd.DataFrame(response.json()["rows"])
# pandas' datetime parsing crashes on this machine's Python 3.14 build.
rows["ended_at"] = rows["ended_at"].astype(str)
counts = rows.groupby("player_id")["match_id"].nunique()
gated = rows[rows["player_id"].isin(counts[counts >= MIN_MATCHES].index)].copy()

original_build = run.build_skill_model
original_parts = run.build_score_parts
original_games = run.build_game_scores
original_seed = run.RANDOM_STATE


def build_with_rally_points(profiles):
    skill_profiles = original_build(profiles)
    points = skill_profiles["player_id"].map(rally_points)
    if points.isna().any():
        raise RuntimeError("some gated players have no rally points; rerun rally-rating-prediction.mjs")
    skill_profiles["skill_score"] = points.astype(float)
    return skill_profiles


def pipeline(use_rally, seed):
    run.RANDOM_STATE = seed
    if use_rally:
        run.build_skill_model = build_with_rally_points
        run.build_score_parts = lambda skill_profiles: {}
        run.build_game_scores = lambda gated_df, skill_profiles: {}
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            final, *_ = run.run_pipeline(gated)
    finally:
        run.RANDOM_STATE = original_seed
        run.build_skill_model = original_build
        run.build_score_parts = original_parts
        run.build_game_scores = original_games
    return final[["player_id", "skill_group", "playstyle_archetype"]].merge(truth, on="player_id")


def between_share(df, column, labels):
    """Share of `column`'s spread inside skill groups that lies between
    the style labels, pooled over groups."""
    between = total = 0.0
    for _, group in df.assign(_style=labels).dropna(subset=["_style"]).groupby("skill_group"):
        values = group[column]
        total += ((values - values.mean()) ** 2).sum()
        between += sum(len(s) * (s.mean() - values.mean()) ** 2 for _, s in values.groupby(group["_style"]))
    return between / total if total else np.nan


def chance_share(df, column, rng):
    scores = []
    for _ in range(SHUFFLES):
        shuffled = df.groupby("skill_group")["playstyle_archetype"].transform(
            lambda s: s.sample(frac=1, random_state=int(rng.integers(1_000_000))).to_numpy()
        )
        scores.append(between_share(df, column, shuffled))
    return float(np.nanmean(scores))


def group_order(df):
    number = df["skill_group"].map(lambda name: int(re.search(r"(\d+)$", str(name)).group(1)))
    return number.corr(df["ability"], method="spearman")


rng = np.random.default_rng(7)
results = []
for seed in SEEDS:
    for label, use_rally in (("A old score", False), ("B rally points", True)):
        df = pipeline(use_rally, seed)
        results.append({
            "version": label,
            "seed": seed,
            "players": len(df),
            "group_order": group_order(df),
            "net_habit": between_share(df, "netPlay", df["playstyle_archetype"]),
            "net_habit_chance": chance_share(df, "netPlay", rng),
            "ability_leak": between_share(df, "ability", df["playstyle_archetype"]),
            "ability_leak_chance": chance_share(df, "ability", rng),
            "styles": df["playstyle_archetype"].nunique(),
        })

table = pd.DataFrame(results)
pd.set_option("display.width", 200)
print(table.round(2).to_string(index=False))
print("\naverage over random starts (spread is the standard deviation):")
summary = table.groupby("version").agg(["mean", "std"]).drop(columns=["seed", "players"], level=0)
print(summary.round(2).to_string())

paired = table.pivot(index="seed", columns="version")
for measure, better in (("net_habit", "higher"), ("ability_leak", "lower"), ("group_order", "higher")):
    diff = paired[(measure, "B rally points")] - paired[(measure, "A old score")]
    wins = (diff > 0).sum() if better == "higher" else (diff < 0).sum()
    print(f"{measure}: rally points better in {wins} of {len(diff)} starts ({better} is better), mean difference {diff.mean():+.2f}")
