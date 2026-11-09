"""Bake one action of a non-humanoid enemy and render its reference clips, in the same layout as the mannequin's: frames/<direction>/%04d.png and frames/reference.json.

blender -b --factory-startup -noaudio --python tools/reference3d/build_creature.py -- --entity e01 --action idle [--res 768] [--dirs L,R] [--keys]

The two-direction sprites are drawn from the front three-quarter (spec 8.11), so L and R use the DL and DR cameras.
"""
import argparse, json, math, os, sys
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from creatures import CREATURES, FPS, FRAMES

ELEVATION = math.radians(35.264)
AZIMUTH = {'L': -45, 'R': -135, 'UL': 45, 'UR': 135, 'DL': -45, 'DR': -135}
EIGHT = {'D': -90}  # What never turns faces the camera straight on.
SIDE = {'L': 1, 'R': -1}  # Which way to swing a two-direction camera toward the side view.


def camera_axes(az):
    a = math.radians(az)
    horiz = Vector((math.cos(a), math.sin(a), 0))
    away = horiz * math.cos(ELEVATION) + Vector((0, 0, math.sin(ELEVATION)))
    right = Vector((-math.sin(a), math.cos(a), 0))
    return away, right, away.cross(right)


def add_solid(shape):
    if shape == 'box':
        bpy.ops.mesh.primitive_cube_add(size=1)
    elif shape == 'cyl':
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=.5, depth=1)
    elif shape == 'ball':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=.5)
    elif shape == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=.5, radius2=.22, depth=1)
    elif shape == 'ring':
        bpy.ops.mesh.primitive_torus_add(major_radius=.5, minor_radius=.07, major_segments=24, minor_segments=8)
    elif shape == 'facet':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=.5)
    elif shape == 'oct':
        bpy.ops.mesh.primitive_cylinder_add(vertices=8, radius=.5 / math.cos(math.pi / 8), depth=1, rotation=(0, 0, math.pi / 8))
        bpy.ops.object.transform_apply(rotation=True)
    obj = bpy.context.object
    obj.rotation_mode = 'XYZ'
    return obj


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--entity', required=True)
    ap.add_argument('--action', required=True)
    ap.add_argument('--out')
    ap.add_argument('--res', type=int, default=768)
    ap.add_argument('--dirs', default='L,R')
    ap.add_argument('--keys', action='store_true', help='render only the key poses for checking')
    args = ap.parse_args(argv)
    creature = CREATURES[args.entity]
    action = creature['actions'][args.action]
    out = os.path.abspath(args.out or f'art-source/reference3d/{args.entity}_{args.action}/frames')
    os.makedirs(out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    materials = {}
    for name, colour in creature['colours'].items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = m.node_tree.nodes['Principled BSDF']
        bsdf.inputs['Base Color'].default_value = (*colour, 1)
        bsdf.inputs['Roughness'].default_value = .6
        materials[name] = m
    # The design sheets carry a weapon on the side the enemy faces, in both directions, and one model can only do that for one of them.
    # A direction listed in 'mirror' renders the model flipped. Only the reference is flipped: H3 still draws that direction from its own drawing.
    flip = bpy.data.objects.new('flip', None)
    bpy.context.scene.collection.objects.link(flip)
    objects = {}
    for name, shape, colour in creature['parts']:
        obj = add_solid(shape)
        obj.name = name
        obj.parent = flip
        obj.data.materials.append(materials[colour])
        objects[name] = obj

    # Bake the pose and keep every corner of every part, so the framing uses the same numbers as the render.
    corners = [Vector((x, y, z)) for x in (-.5, .5) for y in (-.5, .5) for z in (-.5, .5)]
    points = []
    for f in range(FRAMES):
        pose = action['pose'](f)
        for name, obj in objects.items():
            matrix = pose.get(name, Matrix.Scale(0, 4))
            obj.matrix_world = matrix
            obj.keyframe_insert('location', frame=f)
            obj.keyframe_insert('rotation_euler', frame=f)
            obj.keyframe_insert('scale', frame=f)
            points += [matrix @ c for c in corners] if name in pose else []

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = args.res
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 0, FRAMES - 1
    world = bpy.data.worlds.new('neutral')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.6, .6, .62, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .75
    scene.world = world
    cam_data = bpy.data.cameras.new('iso')
    cam_data.type = 'ORTHO'
    # One scale for all actions of an entity, so every take draws it at one size.
    ortho = creature['ortho']
    cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new('iso', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new('key', 'SUN')
    sun_data.energy = 2.6
    sun_data.angle = math.radians(30)
    sun = bpy.data.objects.new('key', sun_data)
    scene.collection.objects.link(sun)
    px = args.res / ortho

    path = os.path.join(out, 'reference.json')
    meta = dict(action=f'{args.entity}_{args.action}', fps=FPS, frames=FRAMES, travel=action['travel'], resolution=args.res, orthoScale=ortho, pxPerMeter=px, elevationDeg=math.degrees(ELEVATION), source='blocking model, tools/reference3d/creatures.py', directions={})
    if os.path.exists(path):
        with open(path, encoding='utf8') as fh:
            meta = dict(json.load(fh), travel=action['travel'])
    for d in args.dirs.split(','):
        azimuth = EIGHT[d] if creature.get('fixed') else AZIMUTH[d] + SIDE.get(d, 0) * creature.get('side_on', 0)
        away, right, up = camera_axes(azimuth)
        side = -1 if d in creature.get('mirror', ()) else 1
        flip.scale = (side, 1, 1)
        seen = [Vector((q.x * side, q.y, q.z)) for q in points]
        xs, ys = [q.dot(right) for q in seen], [q.dot(up) for q in seen]
        cx, cy = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        span = max(max(xs) - min(xs), max(ys) - min(ys))
        if span > ortho * .94:
            print(f'WARNING {args.entity} {args.action} {d}: spans {span:.2f} m of a {ortho} m frame')
        cam.location = right * cx + up * cy + away * 12
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = Matrix((right, up, away)).transposed().to_quaternion()
        sun.rotation_mode = 'QUATERNION'
        sun.rotation_quaternion = (away + right * -.9 + up * .9).to_track_quat('Z', 'Y')
        to_px = lambda q: [round(args.res / 2 + (q.dot(right) - cx) * px, 2), round(args.res / 2 - (q.dot(up) - cy) * px, 2)]
        meta['directions'][d] = dict(azimuthDeg=azimuth, pxPerMeter=px, orthoScale=ortho, rootPx=to_px(Vector((0, 0, 0))))
        folder = os.path.join(out, d)
        os.makedirs(folder, exist_ok=True)
        for f in (action['keys'] if args.keys else range(FRAMES)):
            scene.frame_set(f)
            scene.render.filepath = os.path.join(folder, f'{f:04d}.png')
            bpy.ops.render.render(write_still=True)
    with open(path, 'w', encoding='utf8') as fh:
        json.dump(meta, fh, indent=1)
    print('REFERENCE_DONE', out, 'ortho', ortho, 'pxPerMeter', px)


main()
