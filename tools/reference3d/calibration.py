"""The fixed camera and light of the game as a Blender scene, with one floor tile, one pillar and the mannequin. ART-002.

blender -b --factory-startup -noaudio --python tools/reference3d/calibration.py -- --glb art/Xbot.glb --out art-source/calibration

Saves calibration.blend and a render for each direction. Everything drawn or modelled for the game lines up with these: azimuth 45 degrees, elevation 35.264 degrees, orthographic, light from the upper left of the screen.
A square floor tile projects to a diamond 1.73 times as wide as it is tall, 256 by 148 pixels in spec section 2; the script prints that ratio so that a changed camera shows up at once.
"""
import argparse, math, os, sys
import bpy
from mathutils import Matrix, Vector

ELEVATION = math.radians(35.264)
AZIMUTH = {'UL': 45, 'UR': 135, 'DL': -45, 'DR': -135, 'U': 90, 'R': 180, 'D': -90, 'L': 0}
ORTHO, RES, TILE = 4.2, 768, 1.0


def camera_axes(az):
    a = math.radians(az)
    horiz = Vector((math.cos(a), math.sin(a), 0))
    away = horiz * math.cos(ELEVATION) + Vector((0, 0, math.sin(ELEVATION)))
    right = Vector((-math.sin(a), math.cos(a), 0))
    return away, right, away.cross(right)


def material(name, colour):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*colour, 1)
    return m


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True)
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    out = os.path.abspath(args.out)
    os.makedirs(out, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
    for o in list(bpy.data.objects):
        if o.name == 'Icosphere':
            bpy.data.objects.remove(o)
    floor = material('floor', (.024, .046, .072))
    light_tile = material('tile', (.09, .16, .22))
    stone = material('pillar', (.30, .36, .42))
    # A chequered floor one metre to the square, a pillar one metre square and two metres tall, and the mannequin at the centre.
    for x in range(-3, 4):
        for y in range(-3, 4):
            bpy.ops.mesh.primitive_cube_add(size=1, location=(x * TILE, y * TILE, -.03))
            tile = bpy.context.object
            tile.scale = (TILE, TILE, .06)
            tile.data.materials.append(light_tile if (x + y) % 2 else floor)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(2, .5, 1))
    pillar = bpy.context.object
    pillar.scale = (1, 1, 2)
    pillar.data.materials.append(stone)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = RES
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new('neutral')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (.6, .6, .62, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = .75
    scene.world = world
    cam_data = bpy.data.cameras.new('iso')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = ORTHO
    cam = bpy.data.objects.new('iso', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new('key', 'SUN')
    sun_data.energy = 2.6
    sun_data.angle = math.radians(30)
    sun = bpy.data.objects.new('key', sun_data)
    scene.collection.objects.link(sun)
    for d, az in AZIMUTH.items():
        away, right, up = camera_axes(az)
        cam.location = up * .85 + away * 12
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = Matrix((right, up, away)).transposed().to_quaternion()
        sun.rotation_mode = 'QUATERNION'
        sun.rotation_quaternion = (away + right * -.9 + up * .9).to_track_quat('Z', 'Y')
        scene.render.filepath = os.path.join(out, f'calibration_{d}.png')
        bpy.ops.render.render(write_still=True)
    # The floor diamond's proportions from the same axes the renders used, seen from a diagonal.
    away, right, up = camera_axes(-45)
    corners = [Vector((x, y, 0)) for x in (-.5, .5) for y in (-.5, .5)]
    wide = max(c.dot(right) for c in corners) - min(c.dot(right) for c in corners)
    tall = max(c.dot(up) for c in corners) - min(c.dot(up) for c in corners)
    print(f'CALIBRATION diamond width to height {wide / tall:.3f}, pixels per metre {RES / ORTHO:.1f}')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'calibration.blend'))


main()
