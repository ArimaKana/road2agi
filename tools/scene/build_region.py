"""Build one region's low-poly kit from solids and its painted atlases, and export it for the game.

blender -b --factory-startup -noaudio --python tools/scene/build_region.py -- --region port [--room 1-2]

Reads art-source/scenes/tex-<region>-{floor,wall,prop}.png and writes game/public/assets/scenes/<region>/kit.glb, with one named node per module, and modules.json with each module's footprint and tags.
Sizes are world units: a tile is 1.5, the outer wall 1.2 tall, as in the game's room.ts. Shading is painted into the atlases and a simple height-based occlusion in the vertex colours, so the kit needs no realtime shadows.
--room also lays that room out of level.ts with these modules and renders it from the game's camera to art-source/scenes/rooms/<room>.png.
"""
import argparse, json, math, os, random, re, sys
import bmesh, bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from regions import REGIONS, TILE, WALL_HEIGHT

GRID = 4
ELEVATION, AZIMUTH = math.radians(35.264), -45


def load_material(region, part):
    image = bpy.data.images.load(os.path.abspath(f'art-source/scenes/tex-{region}-{part}.png'))
    image.colorspace_settings.name = 'sRGB'
    image.scale(1024, 1024)
    m = bpy.data.materials.new(f'{region}_{part}')
    m.use_nodes = True
    nodes, links = m.node_tree.nodes, m.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = .9
    tex = nodes.new('ShaderNodeTexImage')
    tex.image = image
    tex.interpolation = 'Linear'
    tint = nodes.new('ShaderNodeVertexColor')
    tint.layer_name = 'shade'
    mix = nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1
    links.new(tex.outputs['Color'], mix.inputs['Color1'])
    links.new(tint.outputs['Color'], mix.inputs['Color2'])
    links.new(mix.outputs['Color'], bsdf.inputs['Base Color'])
    return m


class Kit:
    """Everything here is a list of solids: (shape, centre, size, turn in degrees, atlas, cell)."""

    def __init__(self, region):
        self.materials = [load_material(region, p) for p in ('floor', 'wall', 'prop')]
        self.atlas_index = dict(floor=0, wall=1, prop=2)
        self.modules = {}

    def solid_mesh(self, bm, layer, shade, part):
        shape, centre, size, turn, atlas, cell = part
        if shape == 'box':
            made = bmesh.ops.create_cube(bm, size=1)
        elif shape == 'cyl':
            made = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=.5, radius2=.5, depth=1)
        elif shape == 'cone':
            made = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=.5, radius2=.2, depth=1)
        elif shape == 'ball':
            made = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=.5)
        verts = made['verts']
        rot = Matrix.Rotation(math.radians(turn[2]), 4, 'Z') @ Matrix.Rotation(math.radians(turn[1]), 4, 'Y') @ Matrix.Rotation(math.radians(turn[0]), 4, 'X')
        bmesh.ops.transform(bm, matrix=Matrix.Translation(centre) @ rot @ Matrix.Diagonal((*size, 1)), verts=verts)
        col, row = cell % GRID, cell // GRID
        inset = .012
        faces = {f for v in verts for f in v.link_faces}
        low, high = [min(v.co[i] for v in verts) for i in range(3)], [max(v.co[i] for v in verts) for i in range(3)]
        for face in faces:
            face.material_index = self.atlas_index[atlas]
            n = face.normal
            axis = max(range(3), key=lambda i: abs(n[i]))
            u_axis, v_axis = [(1, 2), (0, 2), (0, 1)][axis]
            for loop in face.loops:
                span_u, span_v = max(high[u_axis] - low[u_axis], 1e-3), max(high[v_axis] - low[v_axis], 1e-3)
                u = (loop.vert.co[u_axis] - low[u_axis]) / span_u
                v = (loop.vert.co[v_axis] - low[v_axis]) / span_v
                loop[layer].uv = ((col + inset + u * (1 - 2 * inset)) / GRID, 1 - (row + inset + (1 - v) * (1 - 2 * inset)) / GRID)
                # Corners low on the ground sit in a soft dark.
                dark = min(1., .78 + max(loop.vert.co.z, 0) * .3)
                loop[shade] = (dark, dark, dark, 1)

    def add(self, name, parts, tags=()):
        mesh = bpy.data.meshes.new(name)
        for m in self.materials:
            mesh.materials.append(m)
        bm = bmesh.new()
        layer = bm.loops.layers.uv.new('UVMap')
        shade = bm.loops.layers.color.new('shade')
        for part in parts:
            self.solid_mesh(bm, layer, shade, part)
        bm.normal_update()
        bm.to_mesh(mesh)
        bm.free()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.scene.collection.objects.link(obj)
        points = [v.co for v in mesh.vertices]
        low, high = [min(p[i] for p in points) for i in range(3)], [max(p[i] for p in points) for i in range(3)]
        self.modules[name] = dict(min=[round(x, 3) for x in low], max=[round(x, 3) for x in high], tags=list(tags), triangles=sum(len(p.vertices) - 2 for p in mesh.polygons))
        return obj


def export(kit, region):
    folder = os.path.abspath(f'game/public/assets/scenes/{region}')
    os.makedirs(folder, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for name in kit.modules:
        bpy.data.objects[name].select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(folder, 'kit.glb'), export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=82, export_vertex_color='ACTIVE', export_yup=True, export_animations=False)
    with open(os.path.join(folder, 'modules.json'), 'w', encoding='utf8') as fh:
        json.dump(dict(region=region, tile=TILE, wallHeight=WALL_HEIGHT, modules=kit.modules), fh, indent=1, ensure_ascii=False)
    print('KIT_DONE', region, len(kit.modules), 'modules', sum(m['triangles'] for m in kit.modules.values()), 'triangles')


def read_room(room_id):
    """The map and traps of one room, read straight from level.ts."""
    text = open('game/src/game/level.ts', encoding='utf8').read()
    start = text.index(f"id: '{room_id}'")
    end = text.find("    {\n      id: '", start + 10)
    block = text[start:end if end > 0 else len(text)]
    rows = re.findall(r"^\s*'([^']+)',?\s*$", block[block.index('map: ['):], re.M)
    traps = {m[0]: m[1] for m in re.findall(r"\b(\w): \{ kind: '(\w+)'", block)}
    return rows, traps


def render_room(kit, region, room_id):
    rows, traps = read_room(room_id)
    spec = REGIONS[region]
    random.seed(room_id)
    cols, count = len(rows[0]), len(rows)
    centre = lambda c, r: Vector(((c + .5 - cols / 2) * TILE, (r + .5 - count / 2) * TILE, 0))
    # The scene's Y is the game's Z.
    def place(name, c, r, turn=0):
        source = bpy.data.objects[name]
        copy = source.copy()
        bpy.context.scene.collection.objects.link(copy)
        copy.location = centre(c, r)
        copy.rotation_euler = (0, 0, math.radians(turn))
    used = set()
    floors = spec['floor_modules']
    for r, row in enumerate(rows):
        for c, mark in enumerate(row):
            if mark == '#':
                place(random.choice(spec['wall_modules']), c, r)
            elif mark in '<>':
                place('door_frame', c, r)
            else:
                place(random.choice(floors), c, r)
                if mark == 'o':
                    place(spec['cover'], c, r)
                elif mark in traps and (mark, 'done') not in used:
                    pass
    for mark, kind in traps.items():
        spots = [(c, r) for r, row in enumerate(rows) for c, m in enumerate(row) if m == mark]
        if not spots:
            continue
        name = spec['trap_modules'].get(kind)
        if name is None:
            continue
        if kind in ('press', 'belt', 'erase'):
            for c, r in spots:
                place(name, c, r)
        else:
            place(name, *spots[0])
    scene_sky = spec['sky']
    # Hide the originals, which all sit at the origin.
    for name in kit.modules:
        bpy.data.objects[name].hide_render = True
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    world = bpy.data.worlds.new('neutral')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    cam_data = bpy.data.cameras.new('iso')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = max(cols, count) * TILE * 1.32
    cam = bpy.data.objects.new('iso', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    a = math.radians(AZIMUTH)
    horiz = Vector((math.cos(a), math.sin(a), 0))
    away = horiz * math.cos(ELEVATION) + Vector((0, 0, math.sin(ELEVATION)))
    right = Vector((-math.sin(a), math.cos(a), 0))
    cam.location = away * 60
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = Matrix((right, away.cross(right), away)).transposed().to_quaternion()
    sun_data = bpy.data.lights.new('key', 'SUN')
    sun_data.energy = 1.6
    sun = bpy.data.objects.new('key', sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_mode = 'QUATERNION'
    sun.rotation_quaternion = (away + right * -.9 + away.cross(right) * .9).to_track_quat('Z', 'Y')
    # Light the room evenly, but keep the backdrop dark: the far layer goes there in the game.
    scene.render.film_transparent = True
    folder = os.path.abspath('art-source/scenes/rooms')
    os.makedirs(folder, exist_ok=True)
    scene.render.filepath = os.path.join(folder, f'{room_id}.png')
    bpy.ops.render.render(write_still=True)
    print('ROOM_DONE', room_id)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--region', required=True)
    ap.add_argument('--room')
    args = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit = Kit(args.region)
    for name, (parts, tags) in REGIONS[args.region]['modules']().items():
        kit.add(name, parts, tags)
    export(kit, args.region)
    if args.room:
        render_room(kit, args.region, args.room)


main()
