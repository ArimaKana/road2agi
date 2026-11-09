// Check every packed clip against its atlas, its master frames and the timing table the simulation uses.
import {readFile,readdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from './media-deps.mjs';
import {ANIMATION_FPS,LIGHT_CHAIN,CHARGE,ULT,FACINGS,WORLD_PER_METRE} from '../game/src/game/simulation.ts';
const manifest=JSON.parse(await readFile('game/public/assets/hero.json','utf8'));
const clips=Object.entries(manifest.actions),cell=120;
const contact=[],report=[];
const missing=[];
let count=0;
assert.deepEqual(manifest.directions,FACINGS);
for(const[key,action]of clips){
  const directions=action.sheets.flatMap(s=>s.directions);
  for(const d of FACINGS)if(!directions.includes(d))missing.push(`${key} ${d}`);
  for(const sheet of action.sheets){
    const meta=await sharp(`game/public/assets/${sheet.file}`).metadata(),[cellW,cellH]=sheet.cell;
    assert.equal(meta.width,sheet.columns*cellW);assert.equal(meta.height,sheet.rows*cellH);assert.equal(meta.hasAlpha,true);assert.ok(meta.width<=4096&&meta.height<=4096,`${key}: atlas too large`);
    for(const d of sheet.directions){
      const dir=`art-source/sequences/${action.sequences}/${d}`,files=(await readdir(dir)).filter(f=>f.endsWith('.png')).sort();assert.equal(files.length,action.frames);
      for(const file of files){
        const{data,info}=await sharp(`${dir}/${file}`).raw().ensureAlpha().toBuffer({resolveWithObject:true});
        let opaque=0,green=0;
        for(let i=0;i<data.length;i+=4){if(data[i+3]>200){opaque++;if(data[i+1]>data[i]+80&&data[i+1]>data[i+2]+80)green++;}}
        assert.ok(opaque/(info.width*info.height)>.03,`${key}/${d}/${file}: empty frame`);assert.ok(green<20,`${key}/${d}/${file}: unkeyed green`);count++;
      }
      const chosen=files[action.hitFrame??Math.floor(files.length/2)];
      contact.push({input:await sharp(`${dir}/${chosen}`).resize(cell,cell,{fit:'contain',background:{r:0,g:0,b:0,alpha:0}}).png().toBuffer(),left:Math.max(0,FACINGS.indexOf(d))*cell,top:clips.findIndex(c=>c[0]===key)*cell});
    }
    report.push({action:key,directions:sheet.directions,framesPerDirection:action.frames,cell:sheet.cell,atlas:[meta.width,meta.height]});
  }
}
for(const[key,clip]of clips)assert.equal(clip.fps,ANIMATION_FPS,`${key}: every clip plays at ${ANIMATION_FPS} fps`);
assert.ok(Math.abs(ULT.duration-manifest.actions.cast.frames/ANIMATION_FPS)<1e-6,'cast: duration differs from the ultimate');
assert.ok(Math.abs(CHARGE.windup-manifest.actions.charge_start.frames/ANIMATION_FPS)<1e-6,'charge_start: duration differs from the wind-up');
for(const attack of [...LIGHT_CHAIN,CHARGE.attack]){
  const clip=manifest.actions[attack.action];
  assert.ok(Math.abs(attack.duration-clip.frames/clip.fps)<1e-6,`${attack.action}: duration differs from the clip`);
  assert.ok(Math.abs(attack.hitAt-clip.hitFrame/clip.fps)<1e-6,`${attack.action}: hit frame differs from the clip`);
  assert.ok(Math.abs(attack.travel-clip.travel*WORLD_PER_METRE)<.01,`${attack.action}: travel differs from the clip`);
}
await sharp({create:{width:cell*FACINGS.length,height:cell*clips.length,channels:4,background:'#213345'}}).composite(contact).png().toFile('qa/deepseek-animation-contact.png');
const gpuBytes=report.reduce((sum,r)=>sum+r.atlas[0]*r.atlas[1]*4,0);
await writeFile('qa/art-validation.json',JSON.stringify({framesValidated:count,gpuMegabytes:Math.round(gpuBytes/2**20),missing,report},null,2));
if(missing.length)console.log(`Not generated yet: ${missing.join(', ')}`);
console.log(`${count} frames validated, ${clips.length} clips, ${Math.round(gpuBytes/2**20)} MB of textures once loaded`);
