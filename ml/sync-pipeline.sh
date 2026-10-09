#!/usr/bin/env bash
# Re-copies the ML pipeline from its own repo into ml/pipeline/.
#
# Railway builds one directory of one repo, so the pipeline has to be
# reachable from inside PaddlePad-umpire. It is vendored rather than
# submoduled or pip-installed: the ML repo has no pyproject.toml, and a
# submodule is fiddly to get Railway to check out.
#
# The rule that keeps this honest: edit the pipeline in its OWN repo,
# then run this. Never edit ml/pipeline/ directly -- those edits would
# be silently reverted by the next sync, and would not exist in the
# repo the thesis is written about.
set -euo pipefail

SOURCE="${1:-$HOME/skul/PaddlePad}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for f in player_profiles.py feature_engineering.py clustering.py; do
    cp "$SOURCE/$f" "$HERE/pipeline/$f"
done

git -C "$SOURCE" rev-parse HEAD > "$HERE/pipeline/VENDORED_FROM"
git -C "$SOURCE" log -1 --format='%ad %s' --date=short >> "$HERE/pipeline/VENDORED_FROM"

echo "Synced from $SOURCE @ $(head -c 8 "$HERE/pipeline/VENDORED_FROM")"
