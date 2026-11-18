"""
Ancient stone for the valley: the Shard archway (the landmark where the world first gains colour), a
ruined column, and weathered blocks built at the exact collider size of each step, floating slab and
plinth in the slice (scripts/terrain/export-props.ts → slice_blocks.json).

All are high-poly sources (bevelled, chipped by displacement, moss on top from the scanned mossy rock)
baked to low-poly game meshes. Walkable tops stay flat so they match collision. Teal glyph inlays are
a separate emissive material.

Blender -b -P scripts/blender/create_gateway.py
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import common as C  # noqa: E402


def glyph_material():
    m = bpy.data.materials.new("ancient_glyph")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.03, 0.25, 0.22, 1)
    b.inputs["Emission Color"].default_value = (0.18, 0.95, 0.85, 1)
    b.inputs["Emission Strength"].default_value = 2.5
    b.inputs["Roughness"].default_value = 0.3
    return m


def stone_pair(name, size, center, bevel=0.06, chip=0.05, flat_top=True, seed=0, subdiv=4):
    """Return (low, high) boxes. The high one is chipped and bevelled; its top stays flat if walkable."""
    def mk(levels, suffix):
        bpy.ops.mesh.primitive_cube_add(size=1, location=center)
        o = bpy.context.active_object
        o.name = name + suffix
        o.scale = size
        bpy.ops.object.transform_apply(scale=True)
        b = o.modifiers.new("bevel", "BEVEL")
        b.width = bevel
        b.segments = 3
        s = o.modifiers.new("sub", "SUBSURF")
        s.levels = levels
        s.subdivision_type = "SIMPLE"
        if levels > 1:
            d = C.displace(o, strength=chip, scale=0.35 + seed * 0.01, kind="CLOUDS", name=f"{name}_chip")
            d.texture_coords = "GLOBAL"
        C.apply_modifiers(o)
        if flat_top and levels > 1:
            top = center[2] + size[2] / 2
            for v in o.data.vertices:
                if v.co.z > top - 0.02:
                    v.co.z = min(v.co.z, top)
        return o
    hi = mk(subdiv, "_high")
    lo = mk(1, "")
    C.shade_smooth(hi, 50)
    C.shade_smooth(lo, 50)
    return lo, hi


def bake_set(name, lows, highs, size, top_asset="moss"):
    """Join lows/highs, bake painted ivory stone + moss in the joints and on top onto the low, return the joined low."""
    C.select_only(*lows)
    bpy.ops.object.join()
    low = bpy.context.active_object
    low.name = name
    C.select_only(*highs)
    bpy.ops.object.join()
    high = bpy.context.active_object
    high.name = name + "_high"
    high.data.materials.clear()
    high.data.materials.append(C.painted_shader(f"{name}_src", "stone", scale=0.7, top_kind=top_asset, top_from=0.6, top_to=0.92, bump=0.9))
    C.uv_unwrap(low, margin=0.006, angle=60)
    low.data.materials.clear()
    low.data.materials.append(C.principled(f"{name}_tmp"))
    col, rough, nrm = C.bake_maps(low, high, size=size, name=name, extrusion=0.08)
    low.data.materials.clear()
    low.data.materials.append(C.baked_material(f"{name}_mat", col, rough, nrm))
    high.hide_render = True
    high.hide_set(True)
    return low


def arch():
    lows, highs = [], []
    for i, x in enumerate((-1.8, 1.8)):
        lo, hi = stone_pair(f"arch_pillar{i}", (0.78, 0.78, 3.4), (x, 0, 1.7), bevel=0.08, chip=0.07, flat_top=False, seed=i)
        lows.append(lo)
        highs.append(hi)
        b_lo, b_hi = stone_pair(f"arch_base{i}", (1.05, 1.05, 0.35), (x, 0, 0.175), bevel=0.05, chip=0.04, seed=i + 3)
        lows.append(b_lo)
        highs.append(b_hi)
    lo, hi = stone_pair("arch_lintel", (4.7, 0.9, 0.72), (0, 0, 3.76), bevel=0.09, chip=0.08, flat_top=False, seed=7)
    lows.append(lo)
    highs.append(hi)
    a = bake_set("shard_arch", lows, highs, 1024)
    # the glyph band, inlaid in the lintel's face (Pip-facing side is -Y in Blender, +z in game)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -0.452, 3.76))
    g = bpy.context.active_object
    g.scale = (1.5, 0.02, 0.17)
    bpy.ops.object.transform_apply(scale=True)
    g.data.materials.append(glyph_material())
    C.select_only(a, g)
    bpy.context.view_layer.objects.active = a
    bpy.ops.object.join()
    a.name = "shard_arch"
    C.origin_to_base(a)
    return a


def column():
    lows, highs = [], []
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.4, depth=2.3, location=(0, 0, 1.45))
    hi = bpy.context.active_object
    hi.name = "column_shaft_high"
    s = hi.modifiers.new("sub", "SUBSURF")
    s.levels = 3
    s.subdivision_type = "SIMPLE"
    d = C.displace(hi, strength=0.05, scale=0.3, name="col_chip")
    d.texture_coords = "GLOBAL"
    C.apply_modifiers(hi)
    # a broken, slanted top
    for v in hi.data.vertices:
        if v.co.z > 2.4:
            v.co.z = 2.4 + v.co.x * 0.25 + (0.12 if v.co.y > 0 else 0)
    C.shade_smooth(hi, 50)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.4, depth=2.3, location=(0, 0, 1.45))
    lo = bpy.context.active_object
    lo.name = "column_shaft"
    for v in lo.data.vertices:
        if v.co.z > 2.4:
            v.co.z = 2.4 + v.co.x * 0.25 + (0.12 if v.co.y > 0 else 0)
    C.shade_smooth(lo, 50)
    lows.append(lo)
    highs.append(hi)
    b_lo, b_hi = stone_pair("column_base", (1.0, 1.0, 0.3), (0, 0, 0.15), bevel=0.05, chip=0.04, seed=11)
    lows.append(b_lo)
    highs.append(b_hi)
    c = bake_set("ruin_column", lows, highs, 512)
    bpy.ops.mesh.primitive_cylinder_add(vertices=14, radius=0.415, depth=0.12, location=(0, 0, 1.45))
    band = bpy.context.active_object
    band.data.materials.append(glyph_material())
    C.select_only(c, band)
    bpy.context.view_layer.objects.active = c
    bpy.ops.object.join()
    c.name = "ruin_column"
    C.origin_to_base(c)
    return c


# Small blocks get a unique baked texture; walls and the cliff are too large for one bake to stay sharp, so
# they keep the chipped geometry and are textured at runtime by projecting the scanned stone from all sides
# (material "stone_wall_tri", see src/game/render/assets.ts).
BAKED = {"step1", "step2", "float1", "plinth"}


def wall_material():
    m = bpy.data.materials.get("stone_wall_tri") or bpy.data.materials.new("stone_wall_tri")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.5, 0.48, 0.45, 1)
    b.inputs["Roughness"].default_value = 0.85
    return m


def blocks():
    p = os.path.join(C.TEX_DIR, "slice_blocks.json")
    data = json.load(open(p))
    out = []
    for i, b in enumerate(data):
        mn, mx = b["min"], b["max"]
        # game (x, y, z) → Blender (x, -z, y), centred on its own origin
        size = (mx["x"] - mn["x"], mx["z"] - mn["z"], mx["y"] - mn["y"])
        name = f"block_{b['id']}"
        if b["id"] in BAKED:
            lo, hi = stone_pair(name, size, (0, 0, size[2] / 2), bevel=0.07, chip=0.06, seed=20 + i)
            o = bake_set(name, [lo], [hi], 512)
        else:
            # chipped, bevelled geometry, lightly decimated; the scanned stone is applied at runtime
            lo, hi = stone_pair(name, size, (0, 0, size[2] / 2), bevel=0.07, chip=0.06, seed=20 + i, subdiv=3)
            bpy.data.objects.remove(lo)
            o = hi
            o.name = name
            d = o.modifiers.new("dec", "DECIMATE")
            d.ratio = 0.35
            C.apply_modifiers(o)
            o.data.materials.clear()
            o.data.materials.append(wall_material())
        C.origin_to_base(o)
        out.append(o)
        C.log(f"{name}: {size[0]:.2f} x {size[2]:.2f} x {size[1]:.2f}, {len(o.data.polygons)} faces")
    return out


def main():
    C.reset_scene()
    bpy.context.scene.cycles.samples = 16
    a = arch()
    c = column()
    bs = blocks()
    C.save_blend("environments/ancient_stone.blend")
    C.export_glb("gateway", [a, c, *bs])
    C.done()


main()
