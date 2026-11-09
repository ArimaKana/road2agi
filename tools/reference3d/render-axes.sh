#!/usr/bin/env bash
# Render and encode the directions the first four-direction pass did not cover: tools/reference3d/render-axes.sh "<actions>" <dirs>
# BLENDER overrides the path to blender.
blender=${BLENDER:-blender}
for a in $1; do
  [ -f "art-source/reference3d/$a/${a}_${2##*,}_512.mp4" ] && continue
  "$blender" -b --factory-startup -noaudio --python tools/reference3d/build_reference.py -- --glb art/Xbot.glb --out "art-source/reference3d/$a/frames" --action "$a" --res 768 --dirs "$2" 2>&1 | grep -E "REFERENCE_DONE|Error|error:" | tail -3
  node tools/reference3d/encode-clips.mjs "$a" "$2"
done
echo "RENDER_DONE $2"
