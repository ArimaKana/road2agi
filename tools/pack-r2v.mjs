// Turn keyed H3 takes into runtime atlases and the hero manifest: node tools/pack-r2v.mjs v5,v4 [action ...]
// The tags are tried in order for each direction, so a newer take replaces an older one where there is one.
// Placement comes from the 3D reference: every direction of a sheet shares one pixels-per-metre, and the sprite anchors on the
// root of the clip, so a step reads as the body walking inside the frame rather than the sprite sliding.
import {existsSync} from 'node:fs';
import {mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import sharp from './media-deps.mjs';
import {ANIMATION_FPS,FACINGS,WORLD_PER_METRE} from '../game/src/game/simulation.ts';
// The hero's eight directions would not fit one 4096 atlas, and the axes were rendered at their own scale, so each set gets a sheet.
const DIAGONALS=['UL','UR','DL','DR'],AXES=['U','R','D','L'];
const span=(from,to,count)=>Array.from({length:count},(_,i)=>Math.round(from+(to-from)*i/(count-1)));
const pingPong=count=>[...Array(count).keys(),...Array.from({length:count-2},(_,i)=>count-2-i)];
// pick: source frames on the reference timeline. They are uneven on purpose, a slow coil, a fast strike and an eased recovery.
// The frame counts and hit frames follow the delivery table in the art spec, section 12.
const CHARGE_SETTLED=[8,16,24,92,100,110];
// Everything plays at ANIMATION_FPS, so a clip lasts as many eighths of a second as it has frames. Few frames, so each pick is a strong pose: the peaks of the 3D timeline, not an even spread.
const PLANS={
  idle:{pick:span(62,93,6),loop:true,order:pingPong(6)},
  // One whole stride cycle of the 48 frame reference.
  run:{pick:span(48,88,6),loop:true},
  dash:{pick:[38,58]},
  // Coil, full stretch, hold, recover.
  light1:{pick:[27,45,64,100],hit:1},
  // Coil, then out and back three times, the deep fourth thrust, settle, recover. The simulation's LIGHT_CHAIN counts on the hits falling on frames 1, 3, 5 and 7.
  flurry:{pick:[22,31,39,47,55,63,71,81,93,112],hit:1},
  // The charged thrust is one take cut in three: the draw, the hold that loops for as long as the button is down, and the strike.
  charge_start:{source:'charge',pick:[18,36],settled:CHARGE_SETTLED,travel:0},
  charge_hold:{source:'charge',pick:[36,41,46],loop:true,order:pingPong(3),settled:CHARGE_SETTLED,travel:0},
  charge_release:{source:'charge',pick:[50,54,66,84,108],hit:1,settled:CHARGE_SETTLED},
  // As long as the simulation's ULT.duration: raise the hand, hold it through the avatar and the fist, lower it.
  cast:{pick:[...span(8,38,5),...span(42,68,6),...span(76,110,5)]},
  // Low glide, full stretch, recover.
  dash_attack:{pick:[26,54,84],hit:1},
  summon:{pick:[14,32,50,70,96],hit:1},
  interact:{pick:[18,34,70,92]},
  hit:{pick:[16,34]},
  // Ends down on one knee. revive and get_up start from there, and their own settled frames are the ones where she stands.
  death:{pick:[18,32,46,66,90,118],settled:[0,4,8,100,110,120]},
  revive:{pick:[16,50,70,84,104],settled:[0,8,14,104,112,120]},
  // The first and last steps of a run. Neither moves through the frame, the game supplies the speed.
  run_start:{pick:[34,70],travel:0},
  run_stop:{pick:[56,88],travel:0},
  knockdown:{pick:[15,34,60],settled:[0,4,8,70,90,120]},
  get_up:{pick:[12,40,60,80],settled:[0,4,10,84,100,120]},
  victory:{pick:[20,40,58,70,84,112]},
};
const sheetsOf=action=>[{directions:DIAGONALS,file:`deepseek-${action}-v005.webp`},{directions:AXES,file:`deepseek-${action}-axes-v005.webp`}];
// Same on-screen height as a standing figure of about 3.3 world units, which is 1.47 projected metres.
const RUNTIME_PX_PER_METRE=64,PADDING=8,MAX_ATLAS=4096,ASSETS='game/public/assets';
const tags=(process.argv[2]||'').split(',').filter(Boolean),only=process.argv.slice(3),names=only.length?only:Object.keys(PLANS);
if(!tags.length)throw new Error('usage: pack-r2v.mjs <tag,tag> [action ...]');
const median=list=>[...list].sort((a,b)=>a-b)[Math.floor(list.length/2)];
// Centre and floor line of the shoes. A lowered blade can reach below them, so only runs of pixels too wide to be a blade count.
async function shoes(file){
  const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const minRun=Math.round(info.width*.012),rows=[];
  let top=info.height,bottom=-1;
  for(let y=0;y<info.height;y++){
    const runs=[];let start=-1;
    for(let x=0;x<=info.width;x++){
      const solid=x<info.width&&data[(y*info.width+x)*4+3]>128;
      if(solid&&start<0)start=x;
      if(!solid&&start>=0){if(x-start>=minRun)runs.push([start,x]);start=-1;}
    }
    if(runs.length){rows[y]=runs;if(y<top)top=y;bottom=y;}
  }
  const from=bottom-(bottom-top)*.06,xs=[];
  for(let y=Math.ceil(from);y<=bottom;y++)for(const[a,b]of rows[y]||[])for(let x=a;x<b;x++)xs.push(x);
  xs.sort((a,b)=>a-b);
  return [(xs[Math.floor(xs.length*.1)]+xs[Math.floor(xs.length*.9)])/2,bottom];
}
const takeOf=(source,d)=>tags.find(tag=>existsSync(`art-source/h3/${source}/${d}/${tag}/rgba/matte.json`));
async function packSheet(action,plan,reference,{directions,file},seqRoot){
  const source=plan.source||action;
  const frameFile=(d,f)=>`art-source/h3/${source}/${d}/${takeOf(source,d)}/rgba/${String(f).padStart(4,'0')}.png`;
  const loaded={},feet={};
  for(const d of directions){
    loaded[d]=[];
    for(const f of plan.pick){
      const {data,info}=await sharp(frameFile(d,f)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
      let x0=info.width,y0=info.height,x1=-1,y1=-1;
      for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>16){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
      if(x1<0)throw new Error(`${action} ${d} frame ${f} is empty`);
      loaded[d].push({f,bbox:[x0,y0,x1,y1],width:info.width,height:info.height});
    }
  }
  const generated=loaded[directions[0]][0].width;
  for(const d of directions)if(loaded[d][0].width!==generated)throw new Error(`${action}: ${directions.join(' ')} mixes takes of different sizes`);
  const scale=generated/reference.resolution,pxPerMetre=(reference.directions[directions[0]].pxPerMeter??reference.pxPerMeter)*scale;
  // H3 places the figure where its pictures show it, not always on the mannequin. Both stand on the same floor in the
  // settled frames at each end of a clip, so the shoes give the offset to carry over to the root.
  const settled=plan.settled||[...plan.pick.slice(0,3),...plan.pick.slice(-3)],roots={},drift={};
  for(const d of directions){
    const gaps=[[],[]];
    for(const f of settled){
      const g=await shoes(frameFile(d,f)),r=await shoes(`art-source/reference3d/${source}/frames/${d}/${String(f).padStart(4,'0')}.png`);
      gaps[0].push(g[0]-r[0]*scale);gaps[1].push(g[1]-r[1]*scale);
    }
    drift[d]=gaps.map(median);
    roots[d]=reference.directions[d].rootPx.map((v,i)=>v*scale+drift[d][i]);
  }
  const extent={};
  for(const d of directions){
    const r=roots[d],boxes=loaded[d].map(l=>l.bbox);
    extent[d]={left:Math.min(...boxes.map(b=>b[0]))-r[0],right:Math.max(...boxes.map(b=>b[2]))-r[0],top:Math.min(...boxes.map(b=>b[1]))-r[1],bottom:Math.max(...boxes.map(b=>b[3]))-r[1]};
  }
  const even=n=>Math.ceil(n/2)*2;
  const cellW=even(Math.max(...directions.map(d=>extent[d].right-extent[d].left))+PADDING*2),cellH=even(Math.max(...directions.map(d=>extent[d].bottom-extent[d].top))+PADDING*2);
  const runtimeScale=RUNTIME_PX_PER_METRE/pxPerMetre,runW=Math.round(cellW*runtimeScale),runH=Math.round(cellH*runtimeScale),frames=plan.pick.length,total=frames*directions.length;
  let columns=Math.max(1,Math.round(Math.sqrt(total*runH/runW)));
  if(columns*runW>MAX_ATLAS)columns=Math.floor(MAX_ATLAS/runW);
  const rows=Math.ceil(total/columns);
  if(rows*runH>MAX_ATLAS)throw new Error(`${action}: atlas ${columns*runW}x${rows*runH} is too large`);
  const anchors={},tips={},composite=[];
  for(const[di,d]of directions.entries()){
    const e=extent[d],r=roots[d],originX=Math.round(r[0]+e.left-((cellW-(e.right-e.left))/2)),originY=Math.round(r[1]+e.top-((cellH-(e.bottom-e.top))/2));
    anchors[d]=[+((r[0]-originX)/cellW).toFixed(4),+(1-(r[1]-originY)/cellH).toFixed(4)];
    // Where the blade tip is on each picked frame, measured like the anchor, for effects that leave from the sword.
    tips[d]=plan.pick.map(f=>{const[x,y]=reference.directions[d].tipPx[f];return[+((x*scale+drift[d][0]-originX)/cellW).toFixed(4),+(1-(y*scale+drift[d][1]-originY)/cellH).toFixed(4)];});
    const out=`${seqRoot}/${d}`;await mkdir(out,{recursive:true});
    for(const[i,l]of loaded[d].entries()){
      // Place through a transparent canvas: the cell can reach past the generated frame on the sword side.
      const left=Math.max(originX,0),top=Math.max(originY,0),width=Math.min(originX+cellW,l.width)-left,height=Math.min(originY+cellH,l.height)-top;
      const part=await sharp(frameFile(d,l.f)).extract({left,top,width,height}).png().toBuffer();
      const master=await sharp({create:{width:cellW,height:cellH,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:part,left:left-originX,top:top-originY}]).png().toBuffer();
      await writeFile(`${out}/${String(i).padStart(3,'0')}.png`,master);
      const small=await sharp(master).resize(runW,runH,{kernel:'lanczos3'}).png().toBuffer();
      const index=di*frames+i;composite.push({input:small,left:(index%columns)*runW,top:Math.floor(index/columns)*runH});
    }
  }
  await sharp({create:{width:columns*runW,height:rows*runH,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite(composite,{limitInputPixels:false}).webp({quality:90,alphaQuality:100,effort:5}).toFile(`${ASSETS}/${file}`);
  console.log(`${action} ${directions.join(' ')}: ${frames}×${directions.length}, cell ${runW}×${runH}, atlas ${columns*runW}×${rows*runH}`);
  return {file,directions,columns,rows,cell:[runW,runH],worldSize:[+(cellW/pxPerMetre*WORLD_PER_METRE).toFixed(3),+(cellH/pxPerMetre*WORLD_PER_METRE).toFixed(3)],anchors,tips,masterCell:[cellW,cellH],masterPxPerMetre:+pxPerMetre.toFixed(2),takes:Object.fromEntries(directions.map(d=>[d,takeOf(source,d)])),rootDrift:Object.fromEntries(directions.map(d=>[d,drift[d].map(Math.round)]))};
}
const manifest=existsSync(`${ASSETS}/hero.json`)?JSON.parse(await readFile(`${ASSETS}/hero.json`,'utf8')):{actions:{}};
delete manifest.dharma;
for(const key of Object.keys(manifest.actions))if(!PLANS[key])delete manifest.actions[key];
for(const action of names){
  const plan=PLANS[action];if(!plan)throw new Error(`No plan for ${action}`);
  const source=plan.source||action,reference=JSON.parse(await readFile(`art-source/reference3d/${source}/frames/reference.json`,'utf8'));
  const seqRoot=`art-source/sequences/${action}`,sheets=[];
  await rm(seqRoot,{recursive:true,force:true});
  for(const sheet of sheetsOf(action)){
    const missing=sheet.directions.filter(d=>!takeOf(source,d));
    if(missing.length){console.log(`${action}: no sheet for ${sheet.directions.join(' ')} yet, missing ${missing.join(' ')}`);continue;}
    sheets.push(await packSheet(action,plan,reference,sheet,seqRoot));
  }
  if(!sheets.length)throw new Error(`${action}: nothing to pack`);
  const entry={frames:plan.pick.length,fps:ANIMATION_FPS,loop:!!plan.loop,sheets,sequences:action,travel:plan.travel??reference.travel,source,sourceFrames:plan.pick};
  if(plan.order)entry.order=plan.order;
  if(plan.hit!==undefined)entry.hitFrame=plan.hit;
  manifest.actions[action]=entry;
}
manifest.version=7;manifest.directions=FACINGS;manifest.model='minimax_h3_ref2va';manifest.pipeline='X Bot 3D reference → ComfyUI MiniMax H3 r2v → chroma key → reference-anchored atlases';
await writeFile(`${ASSETS}/hero.json`,JSON.stringify(manifest,null,2));
