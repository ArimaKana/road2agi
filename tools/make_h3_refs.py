# Crop the existing character references into the images H3 receives.
from PIL import Image
sheet=Image.open('art-source/deepseek-four-directions-v002.png').convert('RGB');w,h=sheet.size;print(sheet.size)
for i,d in enumerate(['UL','UR','DL','DR']):
    sheet.crop(((i%2)*w//2,(i//2)*h//2,(i%2+1)*w//2,(i//2+1)*h//2)).save(f'art-source/h3/refs/pose_{d}.png')
v=Image.open('art-source/references/char03_views.jpg').convert('RGB');print(v.size)
s=v.size[0]/2000
panels=[(46,142,628,1184),(708,142,1290,1184),(1370,142,1952,1184)]
crops=[v.crop(tuple(round(c*s) for c in p)) for p in panels]
out=Image.new('RGB',(sum(c.size[0] for c in crops),crops[0].size[1]),'white');x=0
for c in crops:out.paste(c,(x,0));x+=c.size[0]
out.save('art-source/h3/refs/turnaround.png');print(out.size)
r=Image.open('art-source/references/DeepSeek_刺剑结构_v001.png').convert('RGB');r.thumbnail((640,640),Image.LANCZOS);r.save('art-source/h3/refs/rapier.png');print(r.size)
# H3 draws a character at the size its picture shows when the motion is small, whatever the mannequin's size. These
# versions sit on a generation-sized green canvas at the size and place the mannequin occupies, so size follows the reference.
import json,numpy as np
SIZE,TARGET=896,0.46
meta=json.load(open('art-source/reference3d/idle/frames/reference.json',encoding='utf8'))
for d in ('UL','UR','DL','DR'):
    pose=Image.open(f'art-source/h3/refs/pose_{d}.png').convert('RGB')
    a=np.asarray(pose).astype(int);figure=(a[...,1]-np.maximum(a[...,0],a[...,2]))<60
    ys,xs=np.nonzero(figure);box=(xs.min(),ys.min(),xs.max()+1,ys.max()+1);cut=pose.crop(box)
    k=SIZE*TARGET/cut.height;cut=cut.resize((round(cut.width*k),round(cut.height*k)),Image.LANCZOS)
    # Line the shoes up with the mannequin's: a blade or tail would pull a bounding-box centre to one side.
    m=np.asarray(Image.open(f'art-source/reference3d/idle/frames/{d}/0000.png').convert('RGBA'))[...,3]>128
    def feet(mask):
        ys,xs=np.nonzero(mask);band=ys>=ys.max()-(ys.max()-ys.min())*0.06
        return (np.percentile(xs[band],10)+np.percentile(xs[band],90))/2,ys.max()
    cut_mask=(np.asarray(cut).astype(int)[...,1]-np.asarray(cut).astype(int)[...,[0,2]].max(axis=2))<60
    fx,fy=feet(cut_mask);rx,ry=feet(m);rx,ry=rx*SIZE/m.shape[1],ry*SIZE/m.shape[0]
    canvas=Image.new('RGB',(SIZE,SIZE),(0,255,0));canvas.paste(cut,(round(rx-fx),round(ry-fy)))
    canvas.save(f'art-source/h3/refs/pose_small_{d}.png')
