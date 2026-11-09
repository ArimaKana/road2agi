#!/usr/bin/env bash
# Generate and key every missing take: [SEED=n] [HUB=action] tools/h3-batch.sh <tag> "<actions>" "<directions>"
# The same seed and inputs reproduce the same take, so a take that drifted needs a new SEED.
# HUB starts each take on a picture cut from the settled end of that action's take, for directions with no design sheet.
tag=$1; actions=$2; directions=$3; seed=${SEED:-20261103}
for a in $actions; do for d in $directions; do
  [ -f "art-source/h3/$a/$d/$tag/rgba/matte.json" ] && continue
  pose=()
  if [ -n "$HUB" ]; then python -I tools/fit_pose.py "$a" "$d" --hub "$HUB"; pose=(--pose "hub_$a"); fi
  node tools/comfy-r2v.mjs "$a" "$d" --tag "$tag" --seed "$seed" "${pose[@]}" 2>&1 | tail -1
  python -I tools/matte_frames.py "$a" "$d" "$tag"
done; done
echo "BATCH_DONE $tag"
