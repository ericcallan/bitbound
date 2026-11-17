"""
Scenery props for the modern generations: a cluster of wild mushrooms and a weathered signpost. They stand in
for the cartoon props from Modern HD up (the cartoon versions stay in the stylised generations).

  * mushroom_cluster: three caps of different sizes, sculpted (lumpy rims, gills underneath), with cream spots
    and a speckled orange cap colour baked from a procedural source material
  * signpost: a split, knotted post and an arrow board in scanned bark, baked, with a painted arrow

Blender -b -P scripts/blender/create_props.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402


def cap_source():
    """Orange cap with darker speckle and paler rim, slightly glossy."""
    m = bpy.data.materials.new("mushroom_src")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    noise = C.node(nt, "ShaderNodeTexNoise", (-800, 200))
    noise.inputs["Scale"].default_value = 22.0
    noise.inputs["Detail"].default_value = 6.0
    ramp = C.node(nt, "ShaderNodeValToRGB", (-550, 200))
    ramp.color_ramp.elements[0].position = 0.42
    ramp.color_ramp.elements[0].color = (0.62, 0.12, 0.02, 1)
    ramp.color_ramp.elements[1].position = 0.62
    ramp.color_ramp.elements[1].color = (0.88, 0.26, 0.03, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    # paler toward the rim (geometry z is low there)
    geo = C.node(nt, "ShaderNodeNewGeometry", (-800, -100))
    sep = C.node(nt, "ShaderNodeSeparateXYZ", (-650, -100))
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    mix = C.node(nt, "ShaderNodeMix", (-300, 100), data_type="RGBA")
    # colour sockets of the Mix node (its float/vector sockets share the same names)
    mix_a, mix_b, mix_out = mix.inputs[6], mix.inputs[7], mix.outputs[2]
    mix_b.default_value = (0.95, 0.55, 0.25, 1)
    inv = C.node(nt, "ShaderNodeMath", (-450, -100), operation="SUBTRACT")
    inv.inputs[0].default_value = 1.0
    nt.links.new(sep.outputs["Z"], inv.inputs[1])
    rim = C.node(nt, "ShaderNodeMath", (-380, -160), operation="MULTIPLY")
    rim.inputs[1].default_value = 0.55
    nt.links.new(inv.outputs["Value"], rim.inputs[0])
    nt.links.new(rim.outputs["Value"], mix.inputs[0])
    nt.links.new(ramp.outputs["Color"], mix_a)
    nt.links.new(mix_out, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    bump = C.node(nt, "ShaderNodeBump", (-300, -300))
    bump.inputs["Strength"].default_value = 0.25
    nt.links.new(noise.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def mushroom(name, r, h, loc, rnd):
    parts = []
    # stem: slightly bulbous, leaning
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r * 0.26, depth=h, location=(loc[0], loc[1], h / 2))
    stem = bpy.context.active_object
    for v in stem.data.vertices:
        t = (v.co.z + h / 2) / h
        k = 1.25 - 0.35 * t
        v.co.x *= k
        v.co.y *= k
        v.co.x += t * t * r * 0.15
    stem.data.materials.append(C.principled("mushroom_stem", (0.92, 0.86, 0.72), 0.7))
    parts.append(stem)
    # cap: a squashed half sphere with a lumpy, slightly upturned rim
    bpy.ops.mesh.primitive_uv_sphere_add(segments=28, ring_count=12, radius=r, location=(loc[0] + r * 0.15, loc[1], h))
    cap = bpy.context.active_object
    cap.scale.z = 0.62
    bpy.ops.object.transform_apply(scale=True)
    for v in cap.data.vertices:
        local = v.co - Vector((loc[0] + r * 0.15, loc[1], h))
        if local.z < 0:
            local.z = local.z * 0.15 - 0.02 * r  # flat-ish underside (gills)
        a = math.atan2(local.y, local.x)
        local *= 1 + 0.05 * math.sin(a * 5 + rnd.random() * 6)
        v.co = local + Vector((loc[0] + r * 0.15, loc[1], h))
    cap.data.materials.append(cap_source())
    parts.append(cap)
    # spots
    for _ in range(int(5 + r * 10)):
        a = rnd.uniform(0, math.tau)
        el = rnd.uniform(0.25, 1.2)
        d = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el) * 0.62))
        p = Vector((loc[0] + r * 0.15, loc[1], h)) + d * r
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=4, radius=r * rnd.uniform(0.07, 0.12), location=p)
        sp = bpy.context.active_object
        sp.scale.z = 0.35
        sp.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
        sp.data.materials.append(C.principled("mushroom_spot", (0.98, 0.95, 0.86), 0.6))
        parts.append(sp)
    return parts


def mushroom_cluster():
    rnd = random.Random(3)
    parts = []
    for name, r, h, loc in (("a", 0.3, 0.42, (0, 0)), ("b", 0.18, 0.26, (0.33, 0.12)), ("c", 0.13, 0.18, (-0.22, 0.2))):
        parts += mushroom(name, r, h, loc, rnd)
    for p in parts:
        C.shade_smooth(p, 60)
    C.select_only(*parts)
    bpy.context.view_layer.objects.active = parts[1]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = "mushroom_cluster"
    # bake the procedural cap colour so the game gets a plain texture
    C.uv_unwrap(o, margin=0.01, angle=66)
    hi = o.copy()
    hi.data = o.data.copy()
    bpy.context.scene.collection.objects.link(hi)
    col, rough, nrm = C.bake_maps(o, hi, size=512, name="mushroom", extrusion=0.01)
    o.data.materials.clear()
    o.data.materials.append(C.baked_material("mushroom_mat", col, rough, nrm))
    bpy.data.objects.remove(hi)
    C.origin_to_base(o)
    return o


def signpost():
    rnd = random.Random(9)
    lows, highs = [], []
    # post
    for suffix, sub in (("", 1), ("_high", 3)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.6))
        post = bpy.context.active_object
        post.scale = (0.13, 0.13, 1.2)
        bpy.ops.object.transform_apply(scale=True)
        bev = post.modifiers.new("bev", "BEVEL")
        bev.width = 0.025
        bev.segments = 2
        s = post.modifiers.new("sub", "SUBSURF")
        s.levels = sub
        s.subdivision_type = "SIMPLE"
        if sub > 1:
            d = C.displace(post, strength=0.012, scale=0.08, name="post_grain")
            d.texture_coords = "LOCAL"
        C.apply_modifiers(post)
        post.name = "sign_post" + suffix
        (highs if sub > 1 else lows).append(post)
        # arrow board
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0.12, -0.08, 1.02))
        board = bpy.context.active_object
        board.scale = (0.95, 0.06, 0.3)
        bpy.ops.object.transform_apply(scale=True)
        for v in board.data.vertices:
            if v.co.x > 0.5:  # pointed end
                v.co.x += 0.14 * (1 - abs(v.co.z - 1.02) / 0.15)
        bev = board.modifiers.new("bev", "BEVEL")
        bev.width = 0.015
        s = board.modifiers.new("sub", "SUBSURF")
        s.levels = sub
        s.subdivision_type = "SIMPLE"
        if sub > 1:
            d = C.displace(board, strength=0.006, scale=0.05, name="board_grain")
            d.texture_coords = "LOCAL"
        C.apply_modifiers(board)
        (highs if sub > 1 else lows).append(board)
    C.select_only(*lows)
    bpy.ops.object.join()
    low = bpy.context.active_object
    low.name = "signpost"
    C.select_only(*highs)
    bpy.ops.object.join()
    high = bpy.context.active_object
    high.data.materials.clear()
    high.data.materials.append(C.ph_shader("sign_src", "bark_brown_02", scale=0.45, tint=(1.05, 0.95, 0.85), bump=0.7, bump_dist=0.01))
    C.uv_unwrap(low, margin=0.01, angle=60)
    low.data.materials.append(C.principled("sign_tmp"))
    col, rough, nrm = C.bake_maps(low, high, size=512, name="signpost", extrusion=0.03)
    low.data.materials.clear()
    low.data.materials.append(C.baked_material("signpost_mat", col, rough, nrm))
    high.hide_render = True
    high.hide_set(True)
    # the painted arrow, a thin raised shape on the board's face (game +z = Blender -y)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0.1, -0.115, 1.02))
    stripe = bpy.context.active_object
    stripe.scale = (0.5, 0.01, 0.07)
    bpy.ops.object.transform_apply(scale=True)
    bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.12, depth=0.012, location=(0.42, -0.115, 1.02), rotation=(math.pi / 2, 0, 0))
    head = bpy.context.active_object
    head.rotation_euler = (math.pi / 2, math.pi / 2, 0)
    paint = C.principled("sign_paint", (0.95, 0.88, 0.7), 0.55)
    for o in (stripe, head):
        o.data.materials.append(paint)
    C.select_only(low, stripe, head)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.join()
    low = bpy.context.active_object
    low.name = "signpost"
    C.origin_to_base(low)
    return low


def main():
    C.reset_scene()
    bpy.context.scene.cycles.samples = 16
    m = mushroom_cluster()
    s = signpost()
    s.location.x = 2
    C.save_blend("props/scenery_props.blend")
    s.location.x = 0
    for o in (m, s):
        C.log(f"{o.name}: {C.tri_count(o)} tris")
    C.export_glb("props", [m, s])
    C.done()


main()
