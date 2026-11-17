"""
Next-generation Pip: the same little robot (rounded-square head, faceplate, one antenna, orange and
cream, cyan core, oversized feet), rebuilt as ~30 bevelled, subdivided parts with real panel gaps,
ball joints and rubber-soled boots, a baked 2K material atlas (colour, roughness, metalness, normal)
with edge wear and grime, an 18-bone rig, and 11 keyframed animations.

Blender is Z-up and Pip faces -Y (the exporter turns that into +Z, toward the game's 2D camera).
Origin at the feet. Height to the antenna tip is about 1.06.

Blender -b -P scripts/blender/create_pip.py
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector, Euler  # noqa: E402
import common as C  # noqa: E402

FPS = 24
COL = {
    "orange": (0.87, 0.30, 0.055),
    "orange_dark": (0.48, 0.11, 0.03),
    "cream": (0.98, 0.91, 0.76),
    "cobalt": (0.10, 0.18, 0.62),
    "purple": (0.30, 0.13, 0.62),
    "polymer": (0.045, 0.05, 0.07),
    "rubber": (0.035, 0.03, 0.03),
    "metal": (0.62, 0.62, 0.66),
    "face": (0.01, 0.012, 0.03),
}

# ---------------------------------------------------------------- source materials (Cycles, baked later)


def source_material(name, color, rough, metal=0.0, wear=0.35, grime=0.25, peel=0.04):
    """Paint/metal/polymer with procedural edge wear (pointiness), cavity grime and micro bump."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metal
    geo = C.node(nt, "ShaderNodeNewGeometry", (-1500, 0))
    tc = C.node(nt, "ShaderNodeTexCoord", (-1500, -400))
    noise = C.node(nt, "ShaderNodeTexNoise", (-1250, -400))
    noise.inputs["Scale"].default_value = 18.0
    noise.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], noise.inputs["Vector"])
    # edges: pointiness above ~0.53 reads as a convex edge on these bevelled parts
    edge = C.node(nt, "ShaderNodeMapRange", (-1250, 100))
    edge.inputs["From Min"].default_value = 0.515
    edge.inputs["From Max"].default_value = 0.56
    nt.links.new(geo.outputs["Pointiness"], edge.inputs["Value"])
    wearm = C.node(nt, "ShaderNodeMath", (-1000, 100))
    wearm.operation = "MULTIPLY"
    nt.links.new(edge.outputs["Result"], wearm.inputs[0])
    nt.links.new(noise.outputs["Fac"], wearm.inputs[1])
    wearm2 = C.node(nt, "ShaderNodeMapRange", (-800, 100))
    wearm2.inputs["From Min"].default_value = 0.25
    wearm2.inputs["From Max"].default_value = 0.55
    wearm2.inputs["To Max"].default_value = wear
    nt.links.new(wearm.outputs["Value"], wearm2.inputs["Value"])
    # cavities: pointiness below ~0.49
    cav = C.node(nt, "ShaderNodeMapRange", (-1250, 300))
    cav.inputs["From Min"].default_value = 0.49
    cav.inputs["From Max"].default_value = 0.46
    cav.inputs["To Max"].default_value = grime
    nt.links.new(geo.outputs["Pointiness"], cav.inputs["Value"])
    base = (*color, 1)
    worn = (min(1, color[0] * 0.7 + 0.25), min(1, color[1] * 0.7 + 0.24), min(1, color[2] * 0.7 + 0.22), 1)
    mix1 = C.node(nt, "ShaderNodeMix", (-550, 250))
    mix1.data_type = "RGBA"
    mix1.inputs["A"].default_value = base
    mix1.inputs["B"].default_value = worn
    nt.links.new(wearm2.outputs["Result"], mix1.inputs["Factor"])
    mix2 = C.node(nt, "ShaderNodeMix", (-350, 250))
    mix2.data_type = "RGBA"
    mix2.blend_type = "MULTIPLY"
    mix2.inputs["B"].default_value = (0.35, 0.32, 0.3, 1)
    nt.links.new(cav.outputs["Result"], mix2.inputs["Factor"])
    nt.links.new(mix1.outputs["Result"], mix2.inputs["A"])
    nt.links.new(mix2.outputs["Result"], bsdf.inputs["Base Color"])
    r = C.node(nt, "ShaderNodeMapRange", (-350, 0))
    r.inputs["From Min"].default_value = 0.0
    r.inputs["From Max"].default_value = 1.0
    r.inputs["To Min"].default_value = rough * 0.85
    r.inputs["To Max"].default_value = min(1, rough * 1.15 + 0.08)
    nt.links.new(noise.outputs["Fac"], r.inputs["Value"])
    radd = C.node(nt, "ShaderNodeMath", (-150, 0))
    radd.operation = "ADD"
    radd.use_clamp = True
    nt.links.new(r.outputs["Result"], radd.inputs[0])
    nt.links.new(wearm2.outputs["Result"], radd.inputs[1])
    nt.links.new(radd.outputs["Value"], bsdf.inputs["Roughness"])
    # micro bump: orange-peel paint / brushed metal
    fine = C.node(nt, "ShaderNodeTexNoise", (-600, -500))
    fine.inputs["Scale"].default_value = 140.0
    fine.inputs["Detail"].default_value = 2
    nt.links.new(tc.outputs["Object"], fine.inputs["Vector"])
    bump = C.node(nt, "ShaderNodeBump", (-200, -400))
    bump.inputs["Strength"].default_value = peel
    bump.inputs["Distance"].default_value = 0.002
    nt.links.new(fine.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    m["metal"] = metal
    return m


MATS = {}


def mats():
    MATS.update(
        orange=source_material("paint_orange", COL["orange"], 0.36),
        orange_dark=source_material("paint_orange_dark", COL["orange_dark"], 0.45),
        cream=source_material("paint_cream", COL["cream"], 0.4, wear=0.2),
        cobalt=source_material("paint_cobalt", COL["cobalt"], 0.38),
        purple=source_material("paint_purple", COL["purple"], 0.35),
        polymer=source_material("soft_polymer", COL["polymer"], 0.62, wear=0.1, peel=0.02),
        rubber=source_material("rubber", COL["rubber"], 0.88, wear=0.05, grime=0.1, peel=0.08),
        metal=source_material("metal", COL["metal"], 0.28, metal=1.0, wear=0.15, grime=0.4, peel=0.01),
        face=source_material("face_glass", COL["face"], 0.06, wear=0.0, grime=0.0, peel=0.0),
    )


# ---------------------------------------------------------------- part builders

PARTS = []  # (object, bone)


def finish(o, mat, bone, bevel=0.0, seg=3, subdiv=1):
    if bevel > 0:
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = seg
        b.limit_method = "ANGLE"
    if subdiv:
        s = o.modifiers.new("subd", "SUBSURF")
        s.levels = subdiv
        s.render_levels = subdiv
    C.apply_modifiers(o)
    C.shade_smooth(o, 50)
    o.data.materials.clear()
    o.data.materials.append(MATS[mat] if isinstance(mat, str) else mat)
    PARTS.append((o, bone))
    return o


def rbox(name, size, center, mat, bone, r=0.05, seg=3, subdiv=1):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bone, bevel=r, seg=seg, subdiv=subdiv)


def cyl(name, r, depth, center, mat, bone, axis="Z", verts=24, bevel=0.01, subdiv=0):
    rot = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=center, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(rotation=True)
    return finish(o, mat, bone, bevel=bevel, seg=2, subdiv=subdiv)


def ball(name, r, center, mat, bone, scale=(1, 1, 1), sub=3):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=center)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, bone, subdiv=0)


def torus(name, R, r, center, mat, bone, axis="Z"):
    rot = {"Z": (0, 0, 0), "X": (0, math.pi / 2, 0), "Y": (math.pi / 2, 0, 0)}[axis]
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=32, minor_segments=10, location=center, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    bpy.ops.object.transform_apply(rotation=True)
    return finish(o, mat, bone, subdiv=0)


def build_body():
    # --- boots (oversized, rubber sole, cream toe cap) on spring ankles
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.13 * sx
        rbox(f"boot_{side}", (0.21, 0.30, 0.12), (x, -0.03, 0.08), "cobalt", f"foot_{side}", r=0.05)
        rbox(f"sole_{side}", (0.225, 0.315, 0.045), (x, -0.03, 0.022), "rubber", f"foot_{side}", r=0.018)
        rbox(f"toe_{side}", (0.2, 0.09, 0.08), (x, -0.155, 0.075), "cream", f"foot_{side}", r=0.035)
        rbox(f"cuff_{side}", (0.15, 0.15, 0.04), (x, 0.0, 0.155), "cream", f"shin_{side}", r=0.018)
        cyl(f"shin_{side}", 0.026, 0.12, (x, 0, 0.21), "polymer", f"shin_{side}", subdiv=0)
        for i in range(3):
            torus(f"coil_{side}{i}", 0.045, 0.011, (x, 0, 0.18 + i * 0.028), "metal", f"shin_{side}")
        ball(f"hip_{side}", 0.045, (0.105 * sx, 0, 0.27), "metal", f"thigh_{side}")
    # --- torso
    rbox("belt", (0.38, 0.32, 0.055), (0, 0, 0.285), "orange_dark", "hips", r=0.02)
    rbox("body", (0.36, 0.3, 0.255), (0, 0, 0.42), "orange", "spine", r=0.075, seg=4)
    rbox("belly", (0.24, 0.04, 0.17), (0, -0.148, 0.41), "cream", "spine", r=0.03)
    torus("core_ring", 0.068, 0.015, (0, -0.172, 0.415), "metal", "spine", axis="Y")
    rbox("back_plate", (0.22, 0.03, 0.15), (0, 0.155, 0.43), "orange_dark", "spine", r=0.015)
    for sx in (-1, 1):
        for sz in (0.355, 0.475):
            cyl(f"screw_{sx}_{sz}", 0.009, 0.012, (0.1 * sx, -0.17, sz), "metal", "spine", axis="Y", verts=10, bevel=0.002)
    cyl("neck", 0.06, 0.06, (0, 0, 0.55), "metal", "head", subdiv=0)
    # --- arms: metal shoulder ball, soft polymer upper arm, elbow ball, cream forearm, three-finger hand
    for side, sx in (("L", 1), ("R", -1)):
        x = 0.215 * sx
        ball(f"shoulder_{side}", 0.052, (x, 0, 0.47), "metal", f"upper_{side}")
        cyl(f"upper_{side}", 0.03, 0.07, (x, 0, 0.42), "polymer", f"upper_{side}", subdiv=0)
        ball(f"elbow_{side}", 0.034, (x, 0, 0.385), "metal", f"fore_{side}")
        cyl(f"fore_{side}", 0.04, 0.06, (x, 0, 0.35), "cream", f"fore_{side}", bevel=0.012)
        rbox(f"palm_{side}", (0.095, 0.085, 0.07), (x, 0, 0.3), "cream", f"hand_{side}", r=0.03)
        for i, fy in enumerate((-0.028, 0.0, 0.028)):
            rbox(f"finger_{side}{i}", (0.026, 0.024, 0.05), (x + 0.012 * sx, fy, 0.255), "cream", f"hand_{side}", r=0.011, seg=2)
        rbox(f"thumb_{side}", (0.026, 0.026, 0.045), (x - 0.035 * sx, -0.035, 0.29), "cream", f"hand_{side}", r=0.011, seg=2)
    # --- head: cream shell, orange cap band (separate panel = real seam), recessed glass faceplate, ears
    rbox("shell", (0.52, 0.44, 0.39), (0, 0, 0.75), "cream", "head", r=0.11, seg=5)
    shell = bpy.data.objects["shell"]
    # The orange cap wraps the top of the head: a copy of the shell, cut above a line and grown slightly,
    # leaves a real seam where the cream shell shows below it.
    cap = shell.copy()
    cap.data = shell.data.copy()
    cap.name = "cap"
    bpy.context.scene.collection.objects.link(cap)
    C.select_only(cap)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.bisect(plane_co=(0, 0, 0.875), plane_no=(0, 0, 1), clear_inner=True, use_fill=True)
    bpy.ops.object.mode_set(mode="OBJECT")
    for v in cap.data.vertices:
        v.co.x *= 1.025
        v.co.y *= 1.03
        v.co.z = 0.875 + (v.co.z - 0.875) * 1.12 + 0.004
    cap.data.materials.clear()
    cap.data.materials.append(MATS["orange"])
    PARTS.append((cap, "head"))
    rbox("faceplate", (0.43, 0.05, 0.31), (0, -0.205, 0.74), "face", "head", r=0.06, seg=4)
    for side, sx in (("L", 1), ("R", -1)):
        cyl(f"ear_{side}", 0.058, 0.05, (0.275 * sx, 0, 0.75), "purple", "head", axis="X", bevel=0.012)
        torus(f"ear_ring_{side}", 0.058, 0.009, (0.3 * sx, 0, 0.75), "metal", "head", axis="X")
    cyl("antenna_base", 0.024, 0.025, (0.08, 0.02, 0.97), "metal", "ant_1", subdiv=0)
    cyl("antenna_1", 0.016, 0.06, (0.08, 0.02, 1.0), "purple", "ant_1", subdiv=0, verts=12, bevel=0.004)
    cyl("antenna_2", 0.012, 0.05, (0.08, 0.02, 1.055), "purple", "ant_2", subdiv=0, verts=12, bevel=0.004)


def build_glow_and_face():
    """Unbaked parts: the face display (a live canvas in the game) and the emissive glows."""
    glow = bpy.data.materials.new("pip_glow")
    glow.use_nodes = True
    b = glow.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.05, 0.35, 0.33, 1)
    b.inputs["Emission Color"].default_value = (0.25, 0.95, 0.9, 1)
    b.inputs["Emission Strength"].default_value = 3.0
    b.inputs["Roughness"].default_value = 0.1
    face = bpy.data.materials.new("pip_face")
    face.use_nodes = True
    fb = face.node_tree.nodes["Principled BSDF"]
    fb.inputs["Base Color"].default_value = (0, 0, 0, 1)
    fb.inputs["Emission Color"].default_value = (0.3, 0.95, 1, 1)
    fb.inputs["Emission Strength"].default_value = 1.0
    # A placeholder screen texture: the game draws the live face into this slot. Having a texture
    # here also keeps the card's UVs through optimisation (unused UVs are pruned).
    ph = bpy.data.images.new("pip_face_placeholder", 64, 64)
    ph.pixels = [0.01, 0.012, 0.03, 1.0] * (64 * 64)
    ph.pack()
    tn = C.node(face.node_tree, "ShaderNodeTexImage", (-400, 200), image=ph)
    face.node_tree.links.new(tn.outputs["Color"], fb.inputs["Base Color"])
    out = []
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.05, location=(0, -0.176, 0.415))
    lens = bpy.context.active_object
    lens.name = "core_lens"
    lens.scale = (1, 0.45, 1)
    bpy.ops.object.transform_apply(scale=True)
    C.shade_smooth(lens)
    lens.data.materials.append(glow)
    out.append((lens, "spine"))
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.034, location=(0.08, 0.02, 1.1))
    tip = bpy.context.active_object
    tip.name = "antenna_tip"
    C.shade_smooth(tip)
    tip.data.materials.append(glow)
    out.append((tip, "ant_3"))
    # Face display: a slightly curved card just in front of the glass, UVs 0..1 for the canvas.
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=10, y_subdivisions=6, size=1, location=(0, 0, 0))
    fc = bpy.context.active_object
    fc.name = "face_display"
    for v in fc.data.vertices:
        x, y = v.co.x * 0.36, v.co.y * 0.25
        v.co = Vector((x, -0.238 + 0.05 * x * x, 0.74 + y))
    fc.data.materials.append(face)
    out.append((fc, "head"))
    return out


# ---------------------------------------------------------------- rig

BONES = {
    # name: (head, tail, parent)
    "root": ((0, 0, 0), (0, 0, 0.1), None),
    "hips": ((0, 0, 0.25), (0, 0, 0.3), "root"),
    "spine": ((0, 0, 0.3), (0, 0, 0.53), "hips"),
    "head": ((0, 0, 0.53), (0, 0, 0.92), "spine"),
    "ant_1": ((0.08, 0.02, 0.96), (0.08, 0.02, 1.03), "head"),
    "ant_2": ((0.08, 0.02, 1.03), (0.08, 0.02, 1.08), "ant_1"),
    "ant_3": ((0.08, 0.02, 1.08), (0.08, 0.02, 1.13), "ant_2"),
}
for side, sx in (("L", 1), ("R", -1)):
    BONES.update(
        {
            f"upper_{side}": ((0.215 * sx, 0, 0.47), (0.215 * sx, 0, 0.39), "spine"),
            f"fore_{side}": ((0.215 * sx, 0, 0.39), (0.215 * sx, 0, 0.32), f"upper_{side}"),
            f"hand_{side}": ((0.215 * sx, 0, 0.32), (0.215 * sx, 0, 0.24), f"fore_{side}"),
            f"thigh_{side}": ((0.12 * sx, 0, 0.27), (0.13 * sx, 0, 0.17), "hips"),
            f"shin_{side}": ((0.13 * sx, 0, 0.17), (0.13 * sx, 0, 0.07), f"thigh_{side}"),
            f"foot_{side}": ((0.13 * sx, 0, 0.07), (0.13 * sx, -0.14, 0.05), f"shin_{side}"),
        }
    )


def build_rig():
    arm_data = bpy.data.armatures.new("pip_rig")
    arm = bpy.data.objects.new("pip_rig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    C.select_only(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, (h, t, parent) in BONES.items():
        b = arm_data.edit_bones.new(name)
        b.head = h
        b.tail = t
        b.roll = 0
        if parent:
            b.parent = arm_data.edit_bones[parent]
            b.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in arm.pose.bones:
        pb.rotation_mode = "XYZ"
    return arm


def bind(body, arm):
    body.parent = arm
    mod = body.modifiers.new("rig", "ARMATURE")
    mod.object = arm


# ---------------------------------------------------------------- animation

def pose_key(arm, frame, poses):
    """
    poses: {bone: dict(rx, ry, rz, loc=(x,y,z), scale=(x,y,z))}. Unlisted bones return to rest.
    Feet are kept level automatically: Pip's shins are short, so any knee bend would otherwise tip the
    whole boot. A foot's own rx is an extra toe-up/toe-down offset on top of that compensation.
    """
    poses = {k: dict(v) for k, v in poses.items()}
    for side in ("L", "R"):
        chain = poses.get(f"thigh_{side}", {}).get("rx", 0) + poses.get(f"shin_{side}", {}).get("rx", 0)
        f = poses.setdefault(f"foot_{side}", {})
        f["rx"] = f.get("rx", 0) - chain * 0.92
    for pb in arm.pose.bones:
        p = poses.get(pb.name, {})
        pb.rotation_euler = Euler((p.get("rx", 0), p.get("ry", 0), p.get("rz", 0)), "XYZ")
        pb.location = p.get("loc", (0, 0, 0))
        pb.scale = p.get("scale", (1, 1, 1))
        pb.keyframe_insert("rotation_euler", frame=frame)
        pb.keyframe_insert("location", frame=frame)
        pb.keyframe_insert("scale", frame=frame)


def action(arm, name, keys, loop=True):
    """keys: list of (frame, poses). Looping actions repeat their first key at the end."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = act
    for f, p in keys:
        pose_key(arm, f, p)
    if loop:
        last = keys[-1][0] + (keys[1][0] - keys[0][0] if len(keys) > 1 else 6)
        pose_key(arm, last, keys[0][1])
    # Smooth, slightly anticipatory easing everywhere.
    for fc in _fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.easing = "AUTO"
    C.log(f"action {name}: {len(keys)} keys")
    return act


def _fcurves(act):
    # Blender 4.4+ slotted actions keep fcurves in layer/strip channelbags.
    if hasattr(act, "fcurves") and len(act.fcurves):
        return list(act.fcurves)
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out.extend(bag.fcurves)
    return out


# Bone-local axes (roll 0): for upward bones +rx leans forward (toward -Y, Pip's front);
# for downward limbs -rx swings forward. ry twists; rz bends sideways.

def gait(phase, amp_leg, amp_arm, lean, bob, knee, elbow, twist=0.0):
    s = math.sin(phase)
    c = math.cos(phase)
    return {
        "hips": {"loc": (0, abs(s) * bob - bob * 0.3, 0), "ry": twist * s},
        "spine": {"rx": lean, "ry": -twist * s * 1.4},
        "head": {"rx": -lean * 0.6, "ry": twist * s * 0.6},
        "thigh_L": {"rx": -s * amp_leg},
        "thigh_R": {"rx": s * amp_leg},
        "shin_L": {"rx": max(0, c) * knee},
        "shin_R": {"rx": max(0, -c) * knee},
        "foot_L": {"rx": -max(0, s) * 0.25},
        "foot_R": {"rx": -max(0, -s) * 0.25},
        "upper_L": {"rx": s * amp_arm, "rz": 0.12},
        "upper_R": {"rx": -s * amp_arm, "rz": -0.12},
        "fore_L": {"rx": -elbow},
        "fore_R": {"rx": -elbow},
        "ant_1": {"rx": -lean * 1.5 - c * 0.12},
        "ant_2": {"rx": -lean - c * 0.18},
        "ant_3": {"rx": -c * 0.22},
    }


def build_actions(arm):
    acts = []
    # idle: breathing squash, a curious head tilt, antenna wobble (2 s loop)
    acts.append(action(arm, "idle", [
        (1, {"spine": {"scale": (1, 1, 1)}, "head": {"rz": 0.0}, "ant_1": {"rx": 0.05}, "upper_L": {"rz": 0.1}, "upper_R": {"rz": -0.1}}),
        (13, {"spine": {"scale": (1.012, 1.025, 1.012)}, "head": {"rz": 0.06, "rx": -0.04}, "ant_1": {"rx": -0.08}, "ant_2": {"rx": 0.1}, "upper_L": {"rz": 0.14}, "upper_R": {"rz": -0.14}, "fore_L": {"rx": -0.1}, "fore_R": {"rx": -0.1}}),
        (25, {"spine": {"scale": (1, 1, 1)}, "head": {"rz": 0.0, "ry": 0.12}, "ant_1": {"rx": 0.06}, "ant_2": {"rx": -0.12}, "upper_L": {"rz": 0.1}, "upper_R": {"rz": -0.1}}),
        (37, {"spine": {"scale": (1.012, 1.025, 1.012)}, "head": {"rz": -0.05, "ry": 0.04}, "ant_1": {"rx": -0.06}, "ant_3": {"rx": 0.15}, "upper_L": {"rz": 0.13}, "upper_R": {"rz": -0.13}}),
    ]))
    # walk (1 s loop) and run (0.6 s loop): four keys per cycle
    for name, period, leg, armamp, lean, bob, knee, elbow, twist in (
        ("walk", 24, 0.5, 0.45, 0.06, 0.025, 0.7, 0.35, 0.08),
        ("run", 14, 0.85, 1.0, 0.2, 0.05, 0.95, 1.1, 0.14),
    ):
        keys = []
        for i in range(4):
            f = 1 + i * period / 4
            keys.append((round(f), gait(i * math.pi / 2, leg, armamp, lean, bob, knee, elbow, twist)))
        acts.append(action(arm, name, keys))
    crouch = {
        "hips": {"loc": (0, -0.06, 0)},
        "spine": {"rx": 0.25, "scale": (1.08, 0.86, 1.08)},
        "head": {"rx": -0.15},
        "thigh_L": {"rx": -0.7}, "thigh_R": {"rx": -0.7},
        "shin_L": {"rx": 1.2}, "shin_R": {"rx": 1.2},
        "upper_L": {"rx": 0.6, "rz": 0.2}, "upper_R": {"rx": 0.6, "rz": -0.2},
        "ant_1": {"rx": 0.25}, "ant_2": {"rx": 0.2},
    }
    stretch = {
        "hips": {"loc": (0, 0.02, 0)},
        "spine": {"rx": -0.08, "scale": (0.94, 1.1, 0.94)},
        "head": {"rx": 0.12},
        "thigh_L": {"rx": -0.35}, "thigh_R": {"rx": 0.15},
        "shin_L": {"rx": 0.8}, "shin_R": {"rx": 0.3},
        "upper_L": {"rx": -2.3, "rz": 0.3}, "upper_R": {"rx": -0.6, "rz": -0.5},
        "fore_L": {"rx": -0.3},
        "ant_1": {"rx": 0.35}, "ant_2": {"rx": 0.3}, "ant_3": {"rx": 0.3},
    }
    acts.append(action(arm, "jump_start", [(1, {}), (4, crouch), (6, crouch)], loop=False))
    acts.append(action(arm, "jump_up", [(1, stretch), (12, {**stretch, "ant_3": {"rx": 0.1}})], loop=False))
    fall_a = {
        "spine": {"rx": 0.05, "scale": (0.98, 1.03, 0.98)},
        "upper_L": {"rx": -2.6, "rz": 0.6}, "upper_R": {"rx": -2.6, "rz": -0.6},
        "fore_L": {"rx": -0.5}, "fore_R": {"rx": -0.5},
        "thigh_L": {"rx": -0.3}, "thigh_R": {"rx": 0.2},
        "shin_L": {"rx": 0.5}, "shin_R": {"rx": 0.3},
        "ant_1": {"rx": -0.4}, "ant_2": {"rx": -0.4}, "ant_3": {"rx": -0.3},
    }
    fall_b = {**fall_a, "upper_L": {"rx": -2.3, "rz": 0.8}, "upper_R": {"rx": -2.8, "rz": -0.45}, "thigh_L": {"rx": 0.15}, "thigh_R": {"rx": -0.3}, "ant_2": {"rx": -0.55}}
    acts.append(action(arm, "fall", [(1, fall_a), (7, fall_b)]))
    squash = {**crouch, "spine": {"rx": 0.15, "scale": (1.14, 0.8, 1.14)}, "upper_L": {"rx": -0.2, "rz": 0.7}, "upper_R": {"rx": -0.2, "rz": -0.7}, "ant_1": {"rx": 0.5}, "ant_2": {"rx": 0.45}, "ant_3": {"rx": 0.4}}
    acts.append(action(arm, "land", [(1, squash), (5, {**crouch, "ant_1": {"rx": -0.2}}), (10, {"ant_1": {"rx": 0.1}})], loop=False))
    brace = {
        "hips": {"loc": (0, -0.03, 0)},
        "spine": {"rx": -0.32},
        "head": {"rx": 0.2},
        "thigh_L": {"rx": -0.75}, "thigh_R": {"rx": 0.25},
        "shin_L": {"rx": 0.2}, "shin_R": {"rx": 0.9},
        "foot_L": {"rx": -0.35},
        "upper_L": {"rx": -1.2, "rz": 0.5}, "upper_R": {"rx": -1.0, "rz": -0.6},
        "ant_1": {"rx": -0.5}, "ant_2": {"rx": -0.45}, "ant_3": {"rx": -0.4},
    }
    acts.append(action(arm, "brake", [(1, {}), (4, brace), (12, {**brace, "spine": {"rx": -0.18}}), (18, {})], loop=False))
    pump_up = {
        "hips": {"loc": (0, 0.05, 0)},
        "spine": {"rx": -0.1, "scale": (0.96, 1.07, 0.96)},
        "head": {"rx": 0.15, "rz": 0.1},
        "upper_L": {"rx": -2.9, "rz": 0.15}, "fore_L": {"rx": -0.9},
        "upper_R": {"rx": 0.4, "rz": -0.3},
        "thigh_L": {"rx": -0.2}, "shin_L": {"rx": 0.4},
        "ant_1": {"rx": 0.3}, "ant_3": {"rx": 0.4},
    }
    acts.append(action(arm, "celebrate", [(1, {}), (5, crouch), (10, pump_up), (16, {**pump_up, "fore_L": {"rx": -0.3}}), (22, pump_up), (36, {})], loop=False))
    startle = {
        "hips": {"loc": (0, 0.04, 0)},
        "spine": {"rx": -0.2, "scale": (0.95, 1.08, 0.95)},
        "head": {"rx": 0.25},
        "upper_L": {"rx": -1.6, "rz": 0.9}, "upper_R": {"rx": -1.6, "rz": -0.9},
        "fore_L": {"rx": -0.8}, "fore_R": {"rx": -0.8},
        "ant_1": {"rx": 0.7}, "ant_2": {"rx": 0.5}, "ant_3": {"rx": 0.5},
    }
    acts.append(action(arm, "surprise", [(1, {}), (4, startle), (14, {**startle, "ant_1": {"rx": 0.3}}), (24, {})], loop=False))
    spin = lambda a: {  # noqa: E731
        "hips": {"ry": a, "loc": (0, 0.03, 0)},
        "spine": {"scale": (1.05, 0.95, 1.05)},
        "upper_L": {"rz": 1.3}, "upper_R": {"rz": -1.3},
        "ant_1": {"rz": 0.3}, "ant_2": {"rz": 0.4}, "ant_3": {"rz": 0.4},
    }
    acts.append(action(arm, "shift", [(1, {}), (6, spin(0.8)), (12, spin(2.6)), (18, spin(4.6)), (24, spin(2 * math.pi)), (28, {"hips": {"ry": 2 * math.pi}})], loop=False))
    return acts


# ---------------------------------------------------------------- bake + assemble

def bake_metal(body, img):
    """glTF wants a metalness map; bake it by temporarily routing each material's metal value to emission."""
    saved = []
    for slot in body.material_slots:
        nt = slot.material.node_tree
        b = nt.nodes["Principled BSDF"]
        out = nt.nodes["Material Output"]
        em = nt.nodes.new("ShaderNodeEmission")
        v = slot.material.get("metal", 0.0)
        em.inputs["Color"].default_value = (v, v, v, 1)
        old = out.inputs["Surface"].links[0].from_socket if out.inputs["Surface"].links else None
        nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
        saved.append((nt, out, old, em))
        n = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake__"
        n.image = img
        nt.nodes.active = n
    C.select_only(body)
    bpy.context.scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type="EMIT", margin=8)
    for nt, out, old, em in saved:
        if old:
            nt.links.new(old, out.inputs["Surface"])
        nt.nodes.remove(em)
    d = os.path.join(C.TEX_DIR, "baked")
    img.filepath_raw = os.path.join(d, "pip_metal.png")
    img.file_format = "PNG"
    img.save()


def main():
    C.reset_scene()
    bpy.context.scene.render.fps = FPS
    bpy.context.scene.cycles.samples = 16
    mats()
    build_body()
    extra = build_glow_and_face()
    # one bakeable body mesh: each part rigidly weighted to its bone
    for o, bone in PARTS + extra:
        vg = o.vertex_groups.new(name=bone)
        vg.add([v.index for v in o.data.vertices], 1.0, "REPLACE")
    bodies = [o for o, _ in PARTS]
    C.select_only(*bodies)
    bpy.context.view_layer.objects.active = bodies[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "pip_body"
    C.uv_unwrap(body, margin=0.004, angle=60)
    col, rough, nrm = C.bake_maps(body, None, size=2048, name="pip")
    metal = C.new_image("pip_metal", 2048, non_color=True)
    bake_metal(body, metal)
    # replace source materials with one baked material (metalness from its own map)
    m = C.baked_material("pip_paint", col, rough, nrm)
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tm = C.node(nt, "ShaderNodeTexImage", (-500, 600), image=metal)
    nt.links.new(tm.outputs["Color"], bsdf.inputs["Metallic"])
    body.data.materials.clear()
    body.data.materials.append(m)
    # glow + face stay as separate meshes (their own materials), skinned to the same rig
    for o, _ in extra:
        o.data.uv_layers.new(name="UVMap") if not o.data.uv_layers else None
    face = next(o for o, _ in extra if o.name == "face_display")
    # face UVs: straight 0..1 across the card so the canvas maps exactly
    xs = [v.co.x for v in face.data.vertices]
    zs = [v.co.z for v in face.data.vertices]
    uv = face.data.uv_layers.active.data
    for poly in face.data.polygons:
        for li in poly.loop_indices:
            v = face.data.vertices[face.data.loops[li].vertex_index].co
            uv[li].uv = ((v.x - min(xs)) / (max(xs) - min(xs)), (v.z - min(zs)) / (max(zs) - min(zs)))
    arm = build_rig()
    for o in [body] + [o for o, _ in extra]:
        bind(o, arm)
    build_actions(arm)
    arm.animation_data.action = bpy.data.actions["idle"]
    C.log(f"pip_body {C.tri_count(body)} tris")
    C.save_blend("characters/pip.blend")
    os.makedirs(C.EXPORT_DIR, exist_ok=True)
    p = os.path.join(C.EXPORT_DIR, "pip.glb")
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    for o in arm.children:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=p,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_skins=True,
        export_def_bones=False,
        export_image_format="AUTO",
    )
    C.log("exported", os.path.relpath(p, C.ROOT), f"{os.path.getsize(p) / 1024:.0f} KB")
    C.done()


main()
