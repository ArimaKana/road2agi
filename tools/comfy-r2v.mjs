// Run the MiniMax H3 reference-to-video workflow through a local ComfyUI, one clip per direction.
// node tools/comfy-r2v.mjs light1 DL --tag v3 [--size 896] [--steps 20] [--seed 20261103] [--turbo]
// The graph mirrors ComfyUI/user/default/workflows/video_minimax_h3_r2v.json (same node ids), with the
// reference video branch added and a lossless frame output for matting.
import {createHash} from 'node:crypto';
import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
const flags=process.argv.slice(4),option=(name,fallback)=>{const i=flags.indexOf(`--${name}`);return i<0?fallback:flags[i+1];},poseSet=`_${option('pose','small')}`;
const COMFY=process.env.COMFY_URL||'http://127.0.0.1:8188',COMFY_ROOT=process.env.COMFY_ROOT||'D:/workspace/ComfyUI-aki-v3.2/ComfyUI';
const view={UL:['away from the camera, toward the upper-left','a back three-quarter view','upper-left'],UR:['away from the camera, toward the upper-right','a back three-quarter view','upper-right'],DL:['toward the camera and the lower-left','a front three-quarter view','lower-left'],DR:['toward the camera and the lower-right','a front three-quarter view','lower-right'],U:['straight away from the camera, toward the top','a back view','top of the frame'],D:['straight toward the camera, toward the bottom','a front view','bottom of the frame'],L:['sideways, toward the left','a side profile view','left'],R:['sideways, toward the right','a side profile view','right']};
const deepseekPictures=d=>[`refs/pose${poseSet}_${d}.png`,'refs/turnaround.png','refs/rapier.png'];
const CHARACTERS={
  deepseek:{pictures:deepseekPictures,facing:d=>`She faces ${view[d][0]} of the frame: ${view[d][1]}${action==='run'?'.':`, and the rapier points to the ${view[d][2]} when she thrusts.`}`},
  turn:{pictures:deepseekPictures,facing:d=>`She finishes the turn facing ${view[d][0]} of the frame: ${view[d][1]}, and keeps that facing until the end of the clip.`},
};
const action=process.argv[2],direction=process.argv[3],enemy=/^([eb]\d\de?|decoy|claude)_/.test(action)?action.split('_')[0]:null,move=action.slice(action.indexOf('_')+1);
if(!action||!view[direction])throw new Error('usage: comfy-r2v.mjs <action> <UL|UR|DL|DR|U|R|D|L> [--tag t] [--size n] [--length n] [--steps n] [--turbo] [--seed n] [--scheduler s] [--ref-size match|max] [--pose small]');
// 480 is the production tier: the runtime frames are small enough that a bigger take only costs time and disk.
// 896 is the largest size whose green background held in testing: 1024 turned it black.
const tag=option('tag','take'),size=Number(option('size',480)),length=Number(option('length',124)),turbo=flags.includes('--turbo'),steps=Number(option('steps',turbo?4:20)),seed=Number(option('seed',20261103)),scheduler=option('scheduler','simple'),refSize=option('ref-size','match');
const root='art-source/h3',outDir=`${root}/${action}/${direction}/${tag}`;
// An enemy is drawn from the front three-quarter, its design sheet is the second picture and its words are in enemies.json.
const enemies=enemy?JSON.parse(await readFile('tools/h3-prompts/enemies.json','utf8')):null;
// An elite seen from behind is shown only its back, or the model turns it round to show its front.
const fromBehind=!!enemy&&enemy.endsWith('e')&&direction[0]==='U';
const character=enemy?enemies[enemy].template||'enemy':CHARACTERS[action]?action:'deepseek',spec=enemy?{pictures:d=>[`refs/${enemy}/pose_${move}_${d}.png`,`refs/${enemy}/${fromBehind?'sheet_back.png':enemies[enemy].sheets?.[move]||'sheet.png'}`],facing:d=>enemies[enemy].eight||enemy.endsWith('e')?`It faces ${view[d][0]} of the frame: ${view[d][1]}.${fromBehind?' We see only its back, exactly as in <Picture 1>. Its front, and the front of anything it holds, stays hidden from the camera.':''}`:`It faces toward the camera and the ${d==='L'?'lower-left':'lower-right'} of the frame: a front three-quarter view.`}:CHARACTERS[character];
const motion=enemy?enemies[enemy].motions[move]:JSON.parse(await readFile('tools/h3-prompts/motions.json','utf8'))[action];
const told=(await readFile(`tools/h3-prompts/${character}.txt`,'utf8')).replaceAll('{MOTION}',motion).replaceAll('{FACING}',spec.facing(direction)).replaceAll('{CREATURE}',enemy?enemies[enemy].creature:'').trim();
const prompt=fromBehind?told.replace('which shows it facing both ways, idle and winding up','which shows its back').replace(', its colours and its small white hexagon stencil with a short bar inside',' and its colours'):told;
const pictures=spec.pictures(direction).map(p=>`${root}/${p}`),clip=`art-source/reference3d/${action}/${action}_${direction}_512.mp4`;

async function api(route,init){const r=await fetch(COMFY+route,init);if(!r.ok)throw new Error(`${route}: ${r.status} ${await r.text()}`);return r.json();}
async function upload(file){
  const form=new FormData();form.set('image',new Blob([await readFile(file)]),path.basename(file));form.set('subfolder','road2agi');form.set('overwrite','true');
  const saved=await api('/upload/image',{method:'POST',body:form});return `${saved.subfolder}/${saved.name}`;
}
const uploaded=[];for(const p of pictures)uploaded.push(await upload(p));const video=await upload(clip);
const prefix=`road2agi/${action}_${direction}_${tag}`;
const graph={
  119:{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_video_vae_int8_convrot.safetensors'}},
  120:{class_type:'VAELoader',inputs:{vae_name:'minimax_h3_audio_vae_fp32.safetensors'}},
  123:{class_type:'KSamplerSelect',inputs:{sampler_name:'res_multistep'}},
  127:{class_type:'UNETLoader',inputs:{unet_name:'minimax_h3_ref2va_pruned_int8_convrot.safetensors',weight_dtype:'default'}},
  128:{class_type:'CLIPLoader',inputs:{clip_name:'qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors',type:'minimax',device:'default'}},
  129:{class_type:'RandomNoise',inputs:{noise_seed:seed}},
  145:{class_type:'LoraLoaderModelOnly',inputs:{model:['127',0],lora_name:'minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors',strength_model:1}},
  200:{class_type:'LoadVideo',inputs:{file:video}},
  201:{class_type:'GetVideoComponents',inputs:{video:['200',0]}},
  136:{class_type:'MiniMaxH3ReferenceToVideo',inputs:{clip:['128',0],vae:['119',0],audio_vae:['120',0],prompt,width:size,height:size,length,ref_image_size:refSize,'ref_videos.ref_video_0':['201',0],...Object.fromEntries(uploaded.map((_,i)=>[`ref_images.ref_image_${i}`,[String(137+i*10),0]]))}},
  ...Object.fromEntries(uploaded.map((image,i)=>[137+i*10,{class_type:'LoadImage',inputs:{image}}])),
  124:{class_type:'BasicScheduler',inputs:{model:['127',0],scheduler,steps,denoise:1}},
  126:{class_type:'BasicGuider',inputs:{model:[turbo?'145':'127',0],conditioning:['136',0]}},
  125:{class_type:'SamplerCustomAdvanced',inputs:{noise:['129',0],guider:['126',0],sampler:['123',0],sigmas:['124',0],latent_image:['136',1]}},
  122:{class_type:'VAEDecode',inputs:{samples:['125',0],vae:['119',0]}},
  121:{class_type:'VAEDecodeAudio',inputs:{samples:['125',0],vae:['120',0]}},
  130:{class_type:'CreateVideo',inputs:{images:['122',0],audio:['121',0],fps:24}},
  92:{class_type:'SaveVideo',inputs:{video:['130',0],filename_prefix:prefix,format:'auto',codec:'auto'}},
  202:{class_type:'SaveImage',inputs:{images:['122',0],filename_prefix:`${prefix}_frames/f`}},
};
const started=Date.now();
const {prompt_id:id}=await api('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:graph,client_id:'road2agi-r2v'})});
let entry;
while(!entry){await new Promise(r=>setTimeout(r,5000));const history=await api(`/history/${id}`);entry=history[id];}
const seconds=(Date.now()-started)/1000;
if(entry.status?.status_str!=='success'){console.log(`FAILED ${action} ${direction} ${tag}`,JSON.stringify(entry.status).slice(0,3000));process.exit(1);}
await mkdir(`${outDir}/frames`,{recursive:true});
const output=`${COMFY_ROOT}/output`,images=entry.outputs['202'].images,videos=entry.outputs['92'].images||entry.outputs['92'].video||[];
for(const[i,im]of images.entries())await copyFile(`${output}/${im.subfolder}/${im.filename}`,`${outDir}/frames/${String(i).padStart(4,'0')}.png`);
const v=videos[0],videoFile=`${outDir}/${action}_${direction}_${tag}.mp4`;if(v)await copyFile(`${output}/${v.subfolder}/${v.filename}`,videoFile);
const stateFile=`${root}/runs.json`,runs=existsSync(stateFile)?JSON.parse(await readFile(stateFile,'utf8')):[];
const sha=existsSync(videoFile)?createHash('sha256').update(await readFile(videoFile)).digest('hex'):null;
runs.push({action,direction,tag,promptId:id,seed,size,length,steps,turbo,scheduler,refSize,seconds,pictures,clip,prompt,frames:images.length,video:videoFile,sha256:sha,finishedAt:new Date().toISOString()});
await writeFile(stateFile,JSON.stringify(runs,null,2));
await writeFile(`${outDir}/graph.json`,JSON.stringify(graph,null,1));
console.log(`DONE ${action} ${direction} ${tag}: ${images.length} frames in ${seconds.toFixed(0)}s -> ${outDir}`);
