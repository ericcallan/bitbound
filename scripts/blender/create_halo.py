"""
The end of the Halo Path, in stone: the Stalled Gate (a gatehouse with its door and the stele that opens it), the
world wheel on its dais, and the six version plates in front of it. See src/game/level/meadows.ts (the Stalled
Gate, the World Wheel) and src/game/render/haloEnd.ts, which places each node at its reference point.

Every node's origin is its reference point in the game (no origin_to_base), given here in game coordinates
(x along the path, y up, z toward the 2D camera; Blender is (x, -z, y)). The stone is chipped geometry textured
at runtime by projecting the scanned masonry (materials "stone_wall_tri" and "halo_stone", see
src/game/render/assets.ts), so nothing here needs a bake. Teal inlays use "ancient_glyph"; the wheel's hub and
rim are "wheel_brass".

  halo_gate_back    back tower and lintel over the path          ref (213.0, SEAL, 0)
  halo_gate_front   front tower and the curtain wall down the meadow (shown in 3D only)
  halo_door         the door slab with the six-part wheel emblem    ref (213.0, SEAL, -0.25)
  halo_stele        the stele that holds the wheel's instructions    ref (208.0, SEAL, -2.2)
  halo_wheel        the world wheel, upright, facing the camera      ref (247.6, SEAL + 4.1, -3.9)
  halo_dais         the wheel's stepped dais and its two posts       ref (247.6, SEAL, -4.6)
  halo_plate        one version plate, flush with the path           ref (plate x, SEAL, 0)

Blender -b -P scripts/blender/create_halo.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import common as C  # noqa: E402


def mat(name, base, rough=0.85, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    return m


WALL = lambda: mat("stone_wall_tri", (0.5, 0.48, 0.45))  # noqa: E731  projected stone, dissolves for the camera
SOLID = lambda: mat("halo_stone", (0.55, 0.52, 0.47))  # noqa: E731  projected stone, never cut away
GLYPH = lambda: mat("ancient_glyph", (0.03, 0.25, 0.22), 0.3, emit=(0.18, 0.95, 0.85), strength=2.5)  # noqa: E731
BRASS = lambda: mat("wheel_brass", (0.78, 0.56, 0.26), 0.35, metal=1.0)  # noqa: E731


def g2b(x, y, z):
    """Game coordinates to Blender's."""
    return (x, -z, y)


def block(name, x0, x1, y0, y1, z0, z1, material, chip=0.05, seed=0, bevel=0.07):
    """A chipped, bevelled stone block spanning a game-space box (relative to the node's reference point)."""
    random.seed(seed)
    bpy.ops.mesh.primitive_cube_add(size=1, location=g2b((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = (x1 - x0, z1 - z0, y1 - y0)
    bpy.ops.object.transform_apply(scale=True)
    b = o.modifiers.new("bevel", "BEVEL")
    b.width = bevel
    b.segments = 1
    if chip > 0:
        # a few chips per face: enough to break the silhouette, cheap enough for hundreds of stones
        s = o.modifiers.new("sub", "SUBSURF")
        s.levels = 2
        s.subdivision_type = "SIMPLE"
        d = C.displace(o, strength=chip, scale=0.35 + seed * 0.013, name=f"{name}_chip")
        d.texture_coords = "GLOBAL"
        dec = o.modifiers.new("dec", "DECIMATE")
        dec.ratio = 0.22
    C.apply_modifiers(o)
    o.data.materials.clear()
    o.data.materials.append(material)
    C.shade_smooth(o, 45)
    return o


def join(name, parts):
    C.select_only(*parts)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def courses(prefix, x0, x1, y0, y1, z0, z1, material, rows, seed):
    """A wall laid as courses of stones: rows of blocks with staggered joints, so it reads as masonry."""
    parts = []
    h = (y1 - y0) / rows
    for r in range(rows):
        ya, yb = y0 + r * h, y0 + (r + 1) * h - 0.04
        along = x1 - x0 if (x1 - x0) > (z1 - z0) else z1 - z0
        n = max(1, round(along / 1.1))
        off = 0.5 if r % 2 else 0.0
        cuts = sorted({0.0, along, *[min(along, max(0.0, (i + off) * along / n)) for i in range(1, n + 1)]})
        for i, (a, b) in enumerate(zip(cuts, cuts[1:])):
            if b - a < 0.2:
                continue
            if (x1 - x0) > (z1 - z0):
                parts.append(block(f"{prefix}_{r}_{i}", x0 + a + 0.02, x0 + b - 0.02, ya, yb, z0, z1, material, 0.04, seed + r * 7 + i, 0.05))
            else:
                parts.append(block(f"{prefix}_{r}_{i}", x0, x1, ya, yb, z0 + a + 0.02, z0 + b - 0.02, material, 0.04, seed + r * 7 + i, 0.05))
    return parts


def tower(prefix, z0, z1, y0, y1, seed):
    """A square gate tower: coursed stone, a projecting cap and four merlons."""
    parts = courses(prefix, -1.0, 1.0, y0, y1, z0, z1, WALL(), max(3, round((y1 - y0) / 0.9)), seed)
    parts.append(block(prefix + "_cap", -1.18, 1.18, y1, y1 + 0.32, z0 - 0.18, z1 + 0.18, WALL(), 0.05, seed + 50))
    for i, (sx, sz) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        cx = sx * 0.72
        cz = (z0 + z1) / 2 + sz * ((z1 - z0) / 2 - 0.28)
        parts.append(block(f"{prefix}_m{i}", cx - 0.26, cx + 0.26, y1 + 0.32, y1 + 0.9, cz - 0.24, cz + 0.24, WALL(), 0.04, seed + 60 + i))
    return parts


def emblem(prefix, x_face, sign, cy, cz, r):
    """The world wheel's emblem inlaid on a face that looks along x: a ring and six spokes, teal."""
    parts = []
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.05, major_segments=48, minor_segments=6, location=g2b(x_face + sign * 0.02, cy, cz), rotation=(0, math.pi / 2, 0))
    ring = bpy.context.active_object
    ring.name = prefix + "_ring"
    ring.scale = (0.4, 1, 1)
    bpy.ops.object.transform_apply(scale=True)
    parts.append(ring)
    for i in range(6):
        a = i * math.pi / 3
        bpy.ops.mesh.primitive_cube_add(size=1, location=g2b(x_face + sign * 0.02, cy + math.sin(a) * r * 0.5, cz + math.cos(a) * r * 0.5))
        sp = bpy.context.active_object
        sp.name = f"{prefix}_spoke{i}"
        sp.scale = (0.05, r, 0.07)
        sp.rotation_euler = (a, 0, 0)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        parts.append(sp)
    bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.18, depth=0.06, vertices=24, location=g2b(x_face + sign * 0.02, cy, cz), rotation=(0, math.pi / 2, 0))
    hub = bpy.context.active_object
    hub.name = prefix + "_hub"
    parts.append(hub)
    g = join(prefix, parts)
    g.data.materials.clear()
    g.data.materials.append(GLYPH())
    return g


def gate_back():
    parts = tower("gb_tower", -5.2, -3.0, 0.0, 7.6, 3)
    # the lintel over the path, with a keystone
    parts += courses("gb_lintel", -0.85, 0.85, 5.0, 6.3, -3.0, 2.5, WALL(), 2, 31)
    parts.append(block("gb_key", -0.3, 0.3, 5.7, 6.6, -0.6, 0.1, WALL(), 0.04, 40))
    # a plinth and string course at the tower's foot
    parts.append(block("gb_plinth", -1.2, 1.2, -0.3, 0.35, -5.4, -2.85, WALL(), 0.05, 41))
    return join("halo_gate_back", parts)


def gate_front():
    parts = tower("gf_tower", 2.5, 4.7, -1.8, 7.6, 5)
    # the curtain wall: out across the meadow to where it drops to the stream (the collider runs on, unseen)
    parts += courses("gf_curtain", -0.7, 0.7, -2.4, 4.6, 4.7, 8.2, WALL(), 6, 71)
    parts.append(block("gf_coping", -0.82, 0.82, 4.6, 4.95, 4.6, 8.3, WALL(), 0.04, 90))
    # and a battered end, so it finishes as a wall rather than a cut
    parts.append(block("gf_end", -0.95, 0.95, -2.4, 2.8, 8.0, 8.9, WALL(), 0.05, 91))
    return join("halo_gate_front", parts)


def door():
    parts = courses("door", -0.4, 0.4, 0.0, 5.0, -2.75, 2.75, SOLID(), 5, 101)
    parts.append(block("door_frame_t", -0.46, 0.46, 4.75, 5.0, -2.8, 2.8, SOLID(), 0.03, 120))
    d = join("halo_door", parts)
    em = [emblem("door_em_w", -0.4, -1, 2.6, 0.0, 1.25), emblem("door_em_e", 0.4, 1, 2.6, 0.0, 1.25)]
    return join("halo_door", [d, *em])


def stele():
    parts = [
        block("st_base", -0.85, 0.85, 0.0, 0.32, -0.42, 0.42, SOLID(), 0.05, 201),
        block("st_body", -0.62, 0.62, 0.32, 2.75, -0.2, 0.2, SOLID(), 0.03, 202, 0.05),
    ]
    # a pyramidal cap
    bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.9, radius2=0.05, depth=0.55, location=g2b(0, 3.02, 0), rotation=(0, 0, math.pi / 4))
    cap = bpy.context.active_object
    cap.name = "st_cap"
    cap.scale = (1.0, 0.36, 1.0)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    cap.data.materials.append(SOLID())
    parts.append(cap)
    # a teal band at the foot of the inscription (the face itself is drawn at runtime)
    band = block("st_band", -0.6, 0.6, 0.42, 0.5, 0.17, 0.215, GLYPH(), 0, 203, 0.01)
    parts.append(band)
    return join("halo_stele", parts)


def wheel():
    """Upright in the x-y plane (facing +z, the camera). Six spokes split it into six segments, one per
    generation; the segment faces are left plain for the runtime to paint."""
    R = 3.3
    parts = []
    bpy.ops.mesh.primitive_torus_add(major_radius=R - 0.32, minor_radius=0.32, major_segments=72, minor_segments=10, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    rim = bpy.context.active_object
    rim.name = "wh_rim"
    rim.scale = (1, 1, 0.7)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    rim.data.materials.append(SOLID())
    parts.append(rim)
    # brass bands on the rim's faces
    for i, z in enumerate((0.23, -0.23)):
        bpy.ops.mesh.primitive_torus_add(major_radius=R - 0.32, minor_radius=0.07, major_segments=72, minor_segments=6, location=g2b(0, 0, z), rotation=(math.pi / 2, 0, 0))
        b = bpy.context.active_object
        b.name = f"wh_band{i}"
        b.data.materials.append(BRASS())
        parts.append(b)
    for i in range(6):
        a = i * math.pi / 3 + math.pi / 2
        mx, my = math.cos(a) * (R - 0.3) / 2, math.sin(a) * (R - 0.3) / 2
        bpy.ops.mesh.primitive_cube_add(size=1, location=g2b(mx, my, 0))
        s = bpy.context.active_object
        s.name = f"wh_spoke{i}"
        s.scale = (R - 0.5, 0.26, 0.34)
        s.rotation_euler = (0, -a, 0)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        bv = s.modifiers.new("bev", "BEVEL")
        bv.width = 0.04
        C.apply_modifiers(s)
        s.data.materials.append(SOLID())
        parts.append(s)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.62, depth=0.8, vertices=32, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    hub = bpy.context.active_object
    hub.name = "wh_hub"
    hub.data.materials.append(BRASS())
    parts.append(hub)
    bpy.ops.mesh.primitive_cylinder_add(radius=0.28, depth=1.1, vertices=24, location=(0, 0, 0), rotation=(math.pi / 2, 0, 0))
    cap = bpy.context.active_object
    cap.name = "wh_cap"
    cap.data.materials.append(GLYPH())
    parts.append(cap)
    o = join("halo_wheel", parts)
    C.shade_smooth(o, 40)
    return o


def dais():
    parts = [
        block("da_step0", -4.2, 4.2, 0.0, 0.3, -1.5, 1.5, SOLID(), 0.04, 301),
        block("da_step1", -3.6, 3.6, 0.3, 0.6, -1.25, 0.9, SOLID(), 0.04, 302),
    ]
    # two posts carrying the axle (the wheel turns between them)
    for i, x in enumerate((-3.95, 3.95)):
        parts += courses(f"da_post{i}", x - 0.38, x + 0.38, 0.6, 4.1 + 0.55, -0.4, 0.4, SOLID(), 4, 310 + i * 9)
        parts.append(block(f"da_cap{i}", x - 0.5, x + 0.5, 4.65, 4.95, -0.5, 0.5, SOLID(), 0.04, 330 + i))
    # the axle: from post to post, behind the wheel's hub
    bpy.ops.mesh.primitive_cylinder_add(radius=0.16, depth=7.9, vertices=16, location=g2b(0, 4.1, -0.62), rotation=(0, math.pi / 2, 0))
    ax = bpy.context.active_object
    ax.name = "da_axle"
    ax.data.materials.append(BRASS())
    parts.append(ax)
    return join("halo_dais", parts)


def plate():
    bpy.ops.mesh.primitive_cylinder_add(radius=0.74, depth=0.07, vertices=8, location=g2b(0, 0.03, 0), rotation=(0, 0, math.pi / 8))
    p = bpy.context.active_object
    p.name = "pl_stone"
    bv = p.modifiers.new("bev", "BEVEL")
    bv.width = 0.02
    C.apply_modifiers(p)
    p.data.materials.append(SOLID())
    bpy.ops.mesh.primitive_torus_add(major_radius=0.6, minor_radius=0.03, major_segments=8, minor_segments=4, location=g2b(0, 0.07, 0), rotation=(0, 0, math.pi / 8))
    ring = bpy.context.active_object
    ring.name = "pl_ring"
    ring.data.materials.append(GLYPH())
    return join("halo_plate", [p, ring])


def main():
    C.reset_scene()
    objs = [gate_back(), gate_front(), door(), stele(), wheel(), dais(), plate()]
    for o in objs:
        C.log(f"{o.name}: {C.tri_count(o)} tris")
    C.save_blend("environments/halo.blend")
    C.export_glb("halo", objs)
    C.done()


main()
