"""
The broken aqueduct over the Halo Path canyon: the two surviving ends of a two-tier arched viaduct (Pont du Gard
rather than a plank), in line with the path, each standing on its own piers from the river to the deck, each broken
off over the missing middle span. The deck of each half is exactly its collider (aqA / aqB in src/game/level/meadows.ts, read from
slice_blocks.json); everything below the deck is scenery. Arches are cut with booleans, the stone is chipped, and
the masonry texture is projected at runtime (material "stone_wall_tri_large", see src/game/render/assets.ts), so the
structure stays sharp at any size without a unique bake.

  aq_half_A / aq_half_B   origin at the centre of the deck's underside (where the game places it)
  aq_rubble               fallen voussoirs and deck blocks for the river below the break

Blender -b -P scripts/blender/create_aqueduct.py
"""
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

WATER = -2.7  # game y of the river (WATER_Y)
FOOT = -4.2  # piers go into the water this far
TIER = 6.6  # game y of the string course between the tiers
PIER_W = 1.05  # along the aqueduct
DECK_D = 1.6  # across (z): the deck's depth
LOWER_D = 2.0  # the lower tier is a little thicker


def wall_material():
    m = bpy.data.materials.get("stone_wall_tri_large") or bpy.data.materials.new("stone_wall_tri_large")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.52, 0.47, 1)
    b.inputs["Roughness"].default_value = 0.85
    return m


def box(name, x0, x1, y0, y1, d):
    """A box in game coordinates relative to the half's origin: x along, y up, depth d centred (Blender -y)."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, 0, (y0 + y1) / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = (x1 - x0, d, y1 - y0)
    bpy.ops.object.transform_apply(scale=True)
    return o


def arch_cutter(name, cx, width, spring, top, d):
    """An opening: a box from below up to the springing line, and a cylinder (axis across the deck) on top of it.
    Returned as separate closed meshes, subtracted one after the other."""
    r = width / 2
    b = box(name, cx - r, cx + r, top - 40, spring, d)
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, vertices=40, location=(cx, 0, spring), rotation=(math.pi / 2, 0, 0))
    c = bpy.context.active_object
    c.name = name + "_c"
    return [b, c]


def cut(target, cutters):
    for cutter in cutters if isinstance(cutters, list) else [cutters]:
        m = target.modifiers.new("cut", "BOOLEAN")
        m.operation = "DIFFERENCE"
        m.solver = "EXACT"
        m.object = cutter
        C.apply_modifiers(target)
        bpy.data.objects.remove(cutter)


def dims(o):
    zs = [v.co.z for v in o.data.vertices]
    return f"{len(o.data.vertices)}v z {min(zs):.2f}..{max(zs):.2f}" if zs else "empty"


def union(target, other):
    C.log(f"  union {target.name} [{dims(target)}] + {other.name} [{dims(other)}]")
    m = target.modifiers.new("add", "BOOLEAN")
    m.operation = "UNION"
    m.solver = "EXACT"
    m.object = other
    C.apply_modifiers(target)
    C.log(f"    -> [{dims(target)}]")
    bpy.data.objects.remove(other)


def jagged(name, x, toward, y0, y1, d, seed):
    """A cutter for the broken end: a closed solid whose face toward the structure is a ragged break (a displaced
    grid, extruded straight back), so the boolean always gets a clean manifold. Ragged lower down, where the arch
    gave way; nearly straight at the deck, which must end where its collider ends (Pip walks to the very edge)."""
    random.seed(seed)
    ny, nz = 18, 6
    bm = bmesh.new()
    grid = []
    for i in range(ny + 1):
        row = []
        k = i / ny
        y = y0 + (y1 - y0) * k
        for j in range(nz + 1):
            depth = -d / 2 + d * j / nz
            top = k > 0.82
            disp = random.uniform(0, 0.1) if top else random.uniform(0, 0.4) + (1 - k) * 0.9 + 0.2 * abs(math.sin(y * 2.3 + seed))
            # Blender coordinates: (game x, -game z, game y)
            row.append(bm.verts.new((x - toward * disp, depth, y)))
        grid.append(row)
    faces = []
    for i in range(ny):
        for j in range(nz):
            faces.append(bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j])))
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    back = x + toward * 3.0
    for v in ext["geom"]:
        if isinstance(v, bmesh.types.BMVert):
            v.co.x = back
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    return o


def half(name, x0, x1, deck_y0, deck_y1, piers, broken_end, seed):
    """One half, in coordinates relative to its origin (deck underside centre)."""
    cx = (x0 + x1) / 2
    L = x1 - x0
    lo, hi = -L / 2, L / 2
    oy = deck_y0
    toward = 1 if broken_end > cx else -1  # +1: the break is at the +x end
    deck = box(name, lo, hi, 0, deck_y1 - deck_y0, DECK_D)
    # upper tier: from the string course to the deck, as long as the deck
    upper = box(name + "_u", lo, hi, TIER - oy, 0, DECK_D)
    rel = [p - cx for p in piers]
    spans = list(zip(rel, rel[1:]))
    for i, (a, b) in enumerate(spans):
        w = (b - a) - PIER_W
        cut(upper, arch_cutter(f"{name}_ua{i}", (a + b) / 2, w, 9.2 - oy, 0, DECK_D * 2))
    # past the last pier the upper tier carries on as a broken arch over the fallen span
    end = rel[-1] if toward > 0 else rel[0]
    stub = (hi - end) if toward > 0 else (end - lo)
    if stub > PIER_W:
        w = stub * 2 - PIER_W
        cut(upper, arch_cutter(f"{name}_us", end + toward * (w / 2 + PIER_W / 2), w, 9.2 - oy, 0, DECK_D * 2))
    union(deck, upper)
    # lower tier: tall piers from the river to the string course, big arches between them
    lx0 = min(rel) - PIER_W / 2 - 0.15
    lx1 = max(rel) + PIER_W / 2 + 0.15
    lower = box(name + "_l", lx0, lx1, FOOT - oy, TIER - oy, LOWER_D)
    for i, (a, b) in enumerate(spans):
        w = (b - a) - PIER_W * 1.1
        cut(lower, arch_cutter(f"{name}_la{i}", (a + b) / 2, w, 3.2 - oy, FOOT - oy - 1, LOWER_D * 2))
    union(deck, lower)
    # string courses: a projecting ledge under the deck and between the tiers
    for y, d in ((0, DECK_D + 0.3), (TIER - oy, LOWER_D + 0.25)):
        union(deck, box(name + "_sc", lo if y == 0 else lx0, hi if y == 0 else lx1, y - 0.22, y, d))
    # the break: a ragged face where the half ends over the canyon
    bx = hi if toward > 0 else lo
    cut(deck, jagged(name + "_j", bx - toward * 0.05, toward, TIER - oy - 1.5, deck_y1 - deck_y0 + 1, DECK_D * 2, seed))
    # keep the walkable top exactly flat and at the collider height (the break must not raise it)
    # booleans can leave empty material slots behind: one material, on every face
    deck.data.materials.clear()
    deck.data.materials.append(wall_material())
    for poly in deck.data.polygons:
        poly.material_index = 0
    bev = deck.modifiers.new("bev", "BEVEL")
    bev.width = 0.035
    bev.segments = 1
    bev.limit_method = "ANGLE"
    C.apply_modifiers(deck)
    C.shade_smooth(deck, 35)
    return deck


def rubble(seed):
    """Fallen stones for the river under the gap: voussoir wedges and deck blocks, a few dozen in a heap."""
    random.seed(seed)
    parts = []
    for i in range(22):
        w = random.uniform(0.6, 1.3)
        h = random.uniform(0.45, 0.9)
        d = random.uniform(0.6, 1.4)
        o = box(f"rub{i}", -w / 2, w / 2, 0, h, d)
        m = o.modifiers.new("bev", "BEVEL")
        m.width = 0.06
        C.apply_modifiers(o)
        a = random.uniform(0, math.tau)
        r = random.uniform(0, 3.2)
        o.location = (math.cos(a) * r * 1.3, math.sin(a) * r, random.uniform(-0.3, 0.6))
        o.rotation_euler = (random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(0, math.tau))
        parts.append(o)
    C.select_only(*parts)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    o = parts[0]
    o.name = "aq_rubble"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    o.data.materials.append(wall_material())
    return o


def main():
    C.reset_scene()
    data = {b["id"]: b for b in json.load(open(os.path.join(C.TEX_DIR, "slice_blocks.json")))}
    a = data["aqA"]
    b = data["aqB"]
    # A stub on each bank, in line with the path, standing on its piers; the middle span is gone (in the game it
    # only exists in Early 3D, where the Update Wave passes).
    A = half("aq_half_A", a["min"]["x"], a["max"]["x"], a["min"]["y"], a["max"]["y"], [213.6, 215.75], a["max"]["x"], 11)
    B = half("aq_half_B", b["min"]["x"], b["max"]["x"], b["min"]["y"], b["max"]["y"], [224.25, 226.4], b["min"]["x"], 23)
    R = rubble(5)
    for o in (A, B, R):
        C.log(f"{o.name}: {C.tri_count(o)} tris")
    C.save_blend("environments/aqueduct.blend")
    C.export_glb("aqueduct", [A, B, R])
    C.done()


main()
