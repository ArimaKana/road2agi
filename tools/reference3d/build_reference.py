"""Bake a rapier action on the Mixamo X Bot and render four isometric reference clips.

blender -b --factory-startup --python build_reference.py -- --glb Xbot.glb --out out_dir --action light1 [--res 1024] [--keys]

The bones are solved in Python (two-bone IK + explicit torso/hand frames) and baked per frame, so the
same pose data yields the clips and the metadata used later for anchoring: root pixel, hit frame, blade tip.
"""
import argparse, json, math, os, sys
import bpy
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from actions import ACTIONS

GLB_SCALE = 0.01
ELEVATION = math.radians(35.264)
# Screen direction -> camera azimuth around the character, who faces -Y. See art spec section 2.
AZIMUTH = {'UL': 45, 'UR': 135, 'DL': -45, 'DR': -135, 'U': 90, 'R': 180, 'D': -90, 'L': 0}
BG = (0, 255, 0)
P = 'mixamorig:'


def axis_q(axis, degrees):
    return Quaternion(axis, math.radians(degrees))


def body_q(yaw, lean=0.0, roll=0.0):
    """yaw: turn to the character's left. lean: forward. roll: towards the character's left."""
    return axis_q((0, 0, 1), yaw) @ axis_q((1, 0, 0), lean) @ axis_q((0, 1, 0), roll)


def foot_q(yaw, toe_up=0.0):
    return axis_q((0, 0, 1), yaw) @ axis_q((1, 0, 0), -toe_up)


def frame_q(a, n):
    """Rotation whose columns are limb axis, orthogonalised pole axis and hinge axis."""
    a = a.normalized()
    n = (n - a * n.dot(a)).normalized()
    return Matrix((a, n, a.cross(n))).transposed().to_quaternion()


def two_bone(root, target, len_a, len_b, pole):
    to = target - root
    d = min(max(to.length, abs(len_a - len_b) + 1e-4), (len_a + len_b) * 0.9995)
    u = to.normalized()
    cos_a = (len_a * len_a + d * d - len_b * len_b) / (2 * len_a * d)
    n = (pole - u * pole.dot(u)).normalized()
    joint = root + u * (len_a * cos_a) + n * (len_a * math.sqrt(max(0.0, 1 - cos_a * cos_a)))
    return joint, root + u * d


def ease(kind, t):
    if kind == 'in':
        return t * t * t
    if kind == 'out':
        return 1 - (1 - t) ** 3
    if kind == 'linear':
        return t
    return t * t * (3 - 2 * t)


def interp(action, frame):
    if 'pose_fn' in action:
        return action['pose_fn'](frame)
    tl, lead = action['timeline'], action['lead']
    out = {}
    for ch in tl[0][1]:
        t = max(tl[0][0], min(tl[-1][0], frame + lead.get(ch, 0)))
        for (f0, a_pose, _), (f1, b_pose, kind) in zip(tl, tl[1:]):
            if f0 <= t <= f1:
                w = ease(kind, (t - f0) / (f1 - f0))
                a, b = a_pose[ch], b_pose[ch]
                out[ch] = a.lerp(b, w) if isinstance(a, Vector) else a + (b - a) * w
                break
    # A little breathing so the holds are not frozen.
    out['chest_lean'] += 0.5 * math.sin(frame * 0.18)
    return out


class Rig:
    def __init__(self, arm):
        self.arm = arm
        self.bones = arm.data.bones
        self.rest = {b.name: b.matrix_local.copy() for b in self.bones}
        self.rest_head = {b.name: b.head_local * GLB_SCALE for b in self.bones}
        self.order = []
        for root in [b for b in self.bones if not b.parent]:
            self.order += [root.name] + [c.name for c in root.children_recursive]
        self.order.sort(key=lambda n: len(self.bones[n].parent_recursive))
        for pb in arm.pose.bones:
            pb.rotation_mode = 'QUATERNION'
        self.fingers = {'Right': [], 'Left': []}
        for b in self.bones:
            for side in self.fingers:
                if b.name.startswith(f'{P}{side}Hand') and b.name != f'{P}{side}Hand':
                    self.fingers[side].append(b.name)

    def length(self, a, b):
        return (self.rest_head[P + a] - self.rest_head[P + b]).length

    def solve(self, p):
        R, head = {}, {}
        rh = self.rest_head
        hips_q = body_q(p['hips_yaw'], p['hips_lean'])
        chest_q = body_q(p['chest_yaw'], p['chest_lean'])
        head_q = body_q(p['head_yaw'], p['head_lean'])
        R[P + 'Hips'], R[P + 'Spine'], R[P + 'Spine1'], R[P + 'Spine2'] = hips_q, hips_q.slerp(chest_q, .34), hips_q.slerp(chest_q, .67), chest_q
        R[P + 'Neck'], R[P + 'Head'] = chest_q.slerp(head_q, .5), head_q

        def fk(name):
            bone = self.bones[name]
            if not bone.parent:
                head[name] = p['hips'].copy()
                return
            parent = bone.parent.name
            if parent not in head:
                fk(parent)
            head[name] = head[parent] + R.get(parent, Quaternion()) @ (rh[name] - rh[parent])

        def hip_or_shoulder(name):
            bone = self.bones[P + name]
            parent = bone.parent.name
            if parent not in head:
                fk(parent)
            fk(P + name)
            return head[P + name]

        for side, foot, yaw, up in (('Right', p['rfoot'], p['rfoot_yaw'], p['rfoot_up']), ('Left', p['lfoot'], p['lfoot_yaw'], p['lfoot_up'])):
            hip = hip_or_shoulder(f'{side}UpLeg')
            la, lb = self.length(f'{side}UpLeg', f'{side}Leg'), self.length(f'{side}Leg', f'{side}Foot')
            pole = axis_q((0, 0, 1), yaw) @ Vector((0.12 if side == 'Left' else -0.12, -1, 0.05))
            knee, ankle = two_bone(hip, foot, la, lb, pole)
            rest_a = rh[f'{P}{side}Leg'] - rh[f'{P}{side}UpLeg']
            rest_n = Vector((0, -1, 0))
            rest_q = frame_q(rest_a, rest_n)
            hinge = (knee - hip).cross(pole)
            R[f'{P}{side}UpLeg'] = frame_q(knee - hip, hinge.cross(knee - hip)) @ rest_q.inverted()
            R[f'{P}{side}Leg'] = frame_q(ankle - knee, hinge.cross(ankle - knee)) @ rest_q.inverted()
            R[f'{P}{side}Foot'] = foot_q(yaw, up)
            R[f'{P}{side}ToeBase'] = foot_q(yaw, 0 if up < 1 else up * 0.4)
            R[f'{P}{side}Toe_End'] = R[f'{P}{side}ToeBase']

        for side, hand, pole, sign in (('Right', p['rhand'], p['rpole'], -1), ('Left', p['lhand'], p['lpole'], 1)):
            R[f'{P}{side}Shoulder'] = chest_q
            shoulder = hip_or_shoulder(f'{side}Arm')
            la, lb = self.length(f'{side}Arm', f'{side}ForeArm'), self.length(f'{side}ForeArm', f'{side}Hand')
            elbow, wrist = two_bone(shoulder, hand, la, lb, pole)
            rest_a, rest_n = Vector((sign, 0, 0)), Vector((0, 1, 0))
            rest_q = frame_q(rest_a, rest_n)
            hinge = (elbow - shoulder).cross(pole)
            R[f'{P}{side}Arm'] = frame_q(elbow - shoulder, hinge.cross(elbow - shoulder)) @ rest_q.inverted()
            fore_q = frame_q(wrist - elbow, hinge.cross(wrist - elbow)) @ rest_q.inverted()
            R[f'{P}{side}ForeArm'] = fore_q
            if side == 'Right':
                # Thumb up with the fist behind the blade; rest pose has fingers along the limb, thumb to -Y.
                hand_q = frame_q(p['blade'], Vector((0, 0, 1))) @ frame_q(Vector((sign, 0, 0)), Vector((0, -1, 0))).inverted()
                curl, curl_axis = 72, Vector((0, -1, 0))
            else:
                hand_q = fore_q @ axis_q((0, 1, 0), -10)
                curl, curl_axis = p['lcurl'], Vector((0, 1, 0))
            R[f'{P}{side}Hand'] = hand_q
            for name in self.fingers[side]:
                thumb = 'Thumb' in name
                amount = (curl * 0.45 if thumb else curl)
                seg = int(name[-1]) if name[-1].isdigit() else 3
                R[name] = hand_q @ axis_q(curl_axis, amount * min(seg, 3))

        for name in self.order:
            if name not in head:
                fk(name)
        return R, head

    def bake(self, p, frame):
        R, head = self.solve(p)
        M = {}
        for name in self.order:
            rest = self.rest[name]
            q = R.get(name)
            if q is None:
                parent = self.bones[name].parent
                q = R.setdefault(name, R[parent.name] if parent else Quaternion())
            M[name] = Matrix.Translation(head[name] / GLB_SCALE) @ q.to_matrix().to_4x4() @ rest.to_3x3().to_4x4()
            parent = self.bones[name].parent
            if parent:
                basis = (self.rest[parent.name].inverted() @ rest).inverted() @ M[parent.name].inverted() @ M[name]
            else:
                basis = rest.inverted() @ M[name]
            pb = self.arm.pose.bones[name]
            pb.location, pb.rotation_quaternion, pb.scale = basis.to_translation(), basis.to_quaternion(), (1, 1, 1)
            if frame is not None:
                pb.keyframe_insert('location', frame=frame)
                pb.keyframe_insert('rotation_quaternion', frame=frame)
        return R, head


def material(name, color, metallic=0.0, roughness=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return m


def build_sword():
    """Rapier in its own frame: origin at the grip centre, +Y towards the tip, 1.02 m of blade."""
    parts = []
    steel = material('steel', (0.82, 0.86, 0.95), 0.2, 0.25)
    gold = material('gold', (0.95, 0.62, 0.12), 0.4, 0.35)
    grip = material('grip', (0.05, 0.08, 0.30))

    def add(obj, mat):
        obj.data.materials.append(mat)
        parts.append(obj)

    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.017, radius2=0.002, depth=1.02, location=(0, 0.1 + 0.51, 0), rotation=(-math.pi / 2, 0, 0))
    add(bpy.context.object, steel)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.016, depth=0.16, location=(0, 0, 0), rotation=(-math.pi / 2, 0, 0))
    add(bpy.context.object, grip)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.028, location=(0, -0.09, 0))
    add(bpy.context.object, gold)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.07, minor_radius=0.007, location=(0, 0.095, 0), rotation=(-math.pi / 2, 0, 0))
    add(bpy.context.object, gold)
    bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.008, depth=0.20, location=(0, 0.095, 0), rotation=(0, math.pi / 2, 0))
    add(bpy.context.object, gold)
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    sword = bpy.context.object
    sword.name = 'Rapier'
    bpy.ops.object.select_all(action='DESELECT')
    sword.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    sword.rotation_mode = 'QUATERNION'
    return sword


def sword_matrix(R, head, blade):
    """World matrix of the rapier for the solved pose (armature rest pose is world-aligned at scale 1)."""
    hand = P + 'RightHand'
    q = frame_q(blade, Vector((0, 0, 1)))
    # frame_q columns are (blade, up, side). Mesh +Y runs along the blade and its +X quillons stand upright, thumb on top.
    sword_q = q @ Matrix(((0, 1, 0), (1, 0, 0), (0, 0, -1))).to_quaternion()
    grip = head[hand] + q @ Vector((0.085, -0.012, 0.012))
    return Matrix.Translation(grip) @ sword_q.to_matrix().to_4x4()


def camera_axes(az):
    a = math.radians(az)
    horiz = Vector((math.cos(a), math.sin(a), 0))
    away = horiz * math.cos(ELEVATION) + Vector((0, 0, math.sin(ELEVATION)))
    right = Vector((-math.sin(a), math.cos(a), 0))
    return away, right, away.cross(right)


def main():
    argv = sys.argv[sys.argv.index('--') + 1:]
    ap = argparse.ArgumentParser()
    ap.add_argument('--glb', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--action', required=True)
    ap.add_argument('--res', type=int, default=1024)
    ap.add_argument('--keys', action='store_true', help='render only the key poses for checking')
    ap.add_argument('--dirs', default='UL,UR,DL,DR')
    args = ap.parse_args(argv)
    action = ACTIONS[args.action]
    # Blender resolves relative render paths against its own root, not the shell's working directory.
    args.out = os.path.abspath(args.out)
    os.makedirs(args.out, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(args.glb))
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    arm.animation_data_clear()
    for a in list(bpy.data.actions):
        bpy.data.actions.remove(a)
    for o in list(bpy.data.objects):
        if o.name == 'Icosphere':
            bpy.data.objects.remove(o)
    for m in bpy.data.materials:
        if not m.use_nodes:
            continue
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            joints = 'Joints' in m.name
            bsdf.inputs['Base Color'].default_value = (0.09, 0.10, 0.12, 1) if joints else (0.62, 0.63, 0.66, 1)
            bsdf.inputs['Roughness'].default_value = 0.55
            bsdf.inputs['Metallic'].default_value = 0.0
    rig = Rig(arm)
    sword = build_sword()
    has_sword = action.get('sword', True)
    sword.hide_render = not has_sword

    # Bake and record the skeleton so framing and metadata use the same numbers as the render.
    samples = []
    for f in range(action['frames']):
        p = interp(action, f)
        R, head = rig.bake(p, f)
        m = sword_matrix(R, head, p['blade'])
        sword.location, sword.rotation_quaternion = m.to_translation(), m.to_quaternion()
        sword.keyframe_insert('location', frame=f)
        sword.keyframe_insert('rotation_quaternion', frame=f)
        tip = m @ Vector((0, 1.12, 0))
        samples.append(dict(points=list(head.values()) + ([tip, m.to_translation()] if has_sword else []), tip=tip, grip=m.to_translation(),
                            pelvis=head[P + 'Hips'].copy(), head=head[P + 'HeadTop_End'].copy()))

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = args.res
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
    scene.render.fps = action['fps']
    scene.frame_start, scene.frame_end = 0, action['frames'] - 1
    world = bpy.data.worlds.new('neutral')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.6, 0.6, 0.62, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.75
    scene.world = world
    cam_data = bpy.data.cameras.new('iso')
    cam_data.type = 'ORTHO'
    cam = bpy.data.objects.new('iso', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    sun_data = bpy.data.lights.new('key', 'SUN')
    sun_data.energy = 2.6
    sun_data.angle = math.radians(30)
    sun = bpy.data.objects.new('key', sun_data)
    scene.collection.objects.link(sun)

    # One scale for the directions of one call keeps the same pixels-per-metre across them. A thrust reads longest on the
    # screen axes, so the axes are rendered in a call of their own and each direction records the scale it got.
    # The mannequin is much narrower than the character it drives: leave room for the skirt, hair and tail.
    side_margin, vertical_margin = action.get('margins', (0.55, 0.26))
    directions = args.dirs.split(',')
    bounds = {}
    for d in directions:
        _, right, up = camera_axes(AZIMUTH[d])
        xs = [q.dot(right) for s in samples for q in s['points']]
        ys = [q.dot(up) for s in samples for q in s['points']]
        bounds[d] = (min(xs) - side_margin, max(xs) + side_margin, min(ys) - vertical_margin, max(ys) + vertical_margin)
    ortho = action.get('ortho') or max(max(b[1] - b[0], b[3] - b[2]) for b in bounds.values()) * 1.04
    cam_data.ortho_scale = ortho
    px = args.res / ortho

    # Directions rendered earlier stay on record, so a later call only adds to the file.
    path = os.path.join(args.out, 'reference.json')
    meta = dict(action=args.action, fps=action['fps'], frames=action['frames'], travel=action['travel'], resolution=args.res,
                orthoScale=ortho, pxPerMeter=px, elevationDeg=math.degrees(ELEVATION), source='Mixamo X Bot via three.js examples',
                directions={})
    if os.path.exists(path):
        with open(path, encoding='utf8') as fh:
            meta = dict(json.load(fh), travel=action['travel'], frames=action['frames'], fps=action['fps'])
    for d in directions:
        b = bounds[d]
        cx, cy = (b[0] + b[1]) / 2, (b[2] + b[3]) / 2

        def place_camera(az):
            away, right, up = camera_axes(az)
            cam.location = right * cx + up * cy + away * 12
            cam.rotation_mode = 'QUATERNION'
            cam.rotation_quaternion = Matrix((right, up, away)).transposed().to_quaternion()
            sun.rotation_mode = 'QUATERNION'
            sun.rotation_quaternion = (away + right * -0.9 + up * 0.9).to_track_quat('Z', 'Y')
            return right, up

        right, up = place_camera(AZIMUTH[d])

        def to_px(q):
            return [round(args.res / 2 + (q.dot(right) - cx) * px, 2), round(args.res / 2 - (q.dot(up) - cy) * px, 2)]

        meta['directions'][d] = dict(azimuthDeg=AZIMUTH[d], pxPerMeter=px, orthoScale=ortho, rootPx=to_px(Vector((0, 0, 0))), tipPx=[to_px(s['tip']) for s in samples],
                                     gripPx=[to_px(s['grip']) for s in samples], pelvisPx=[to_px(s['pelvis']) for s in samples])
        frames = action['keys'] if args.keys else range(action['frames'])
        folder = os.path.join(args.out, d)
        os.makedirs(folder, exist_ok=True)
        for f in frames:
            scene.frame_set(f)
            if 'turn' in action:
                place_camera(AZIMUTH[d] + action['turn'](f))
            scene.render.filepath = os.path.join(folder, f'{f:04d}.png')
            bpy.ops.render.render(write_still=True)
    with open(path, 'w', encoding='utf8') as fh:
        json.dump(meta, fh, indent=1)
    print('REFERENCE_DONE', args.out, 'ortho', ortho, 'pxPerMeter', px)


main()
