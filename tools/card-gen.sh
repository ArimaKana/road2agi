#!/usr/bin/env bash
# Generate one card image with the Codex app's own codex.exe: tools/card-gen.sh <tag> [reference images...]
# Reads art-source/cards/<tag>.prompt.txt and saves art-source/cards/<tag>.png. A new card's prompt is _style.txt + <id>.subject.txt.
# Codex keeps the picture in its own folder and names it in its last message, so the copy is taken from there.
# OUT picks another folder: the enemy sheets use OUT=art-source/enemies, with prompts made from _style.txt or _elite.txt + <id>.subject.txt.
tag=$1; shift
out=${OUT:-art-source/cards}
codex=${CODEX:-$(ls -d "$LOCALAPPDATA"/OpenAI/Codex/bin/*/codex.exe | head -1)}
refs=(); for r in "$@"; do refs+=(-i "$r"); done
"$codex" exec --skip-git-repo-check -s workspace-write -c model_reasoning_effort='"low"' \
  -o "$out/$tag.codex.txt" "${refs[@]}" - < "$out/$tag.prompt.txt" > "$out/$tag.log" 2>&1
image=$(grep -oE '[A-Za-z]:[\\/][^)`"]*generated_images[^)`"]*\.png' "$out/$tag.codex.txt" | tail -1)
[ -f "$image" ] || { echo "$tag: no image, see $out/$tag.log"; exit 1; }
cp "$image" "$out/$tag.png"
echo "$out/$tag.png"
