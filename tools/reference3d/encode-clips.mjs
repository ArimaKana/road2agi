// Composite the RGBA reference renders over the key colour and encode one clip per direction, plus a QA grid.
// node tools/reference3d/encode-clips.mjs light1 [U,R,D,L]
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
const action=process.argv[2],root=`art-source/reference3d/${action}`,directions=(process.argv[3]||'UL,UR,DL,DR').split(',');
const meta=JSON.parse(await readFile(`${root}/frames/reference.json`,'utf8')),size=meta.resolution;
const run=args=>{const r=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8'});if(r.status)throw new Error(r.stderr);};
const x264=['-c:v','libx264','-crf','12','-preset','slow','-pix_fmt','yuv420p','-movflags','+faststart'];
for(const d of directions){
  run(['-f','lavfi','-i',`color=c=0x00FF00:s=${size}x${size}:r=${meta.fps}`,'-framerate',String(meta.fps),'-i',`${root}/frames/${d}/%04d.png`,'-filter_complex','[0][1]overlay=shortest=1:format=auto,format=yuv420p','-frames:v',String(meta.frames),...x264,`${root}/${action}_${d}.mp4`]);
  // Reference tokens ride along every sampling step, so the clip sent to H3 stays small.
  run(['-i',`${root}/${action}_${d}.mp4`,'-vf','scale=512:512:flags=lanczos',...x264,`${root}/${action}_${d}_512.mp4`]);
}
if(directions.length===4)run([...directions.flatMap(d=>['-i',`${root}/${action}_${d}.mp4`]),'-filter_complex',directions.map((_,i)=>`[${i}]scale=512:512[v${i}]`).join(';')+';[v0][v1]hstack[a];[v2][v3]hstack[b];[a][b]vstack',...x264,`${root}/${action}_grid_${directions[0]}.mp4`]);
console.log(`${action}: ${directions.join(' ')}, ${meta.frames} frames at ${meta.fps} fps, ${size}px, ${meta.directions[directions[0]].pxPerMeter?.toFixed(1)??meta.pxPerMeter.toFixed(1)} px/m`);
