"""
Trees for the valley: the signature Great Tree and a smaller meadow tree that fills the forest edge.

Trunk and branches grow from a recursive skeleton turned into one continuous mesh by the Skin
modifier (flared roots, tapering limbs, bark irregularity). Bark comes from a scanned Poly Haven set,
baked with Cycles ambient occlusion into a texture atlas. The canopy is ~1500 crossed foliage cards
(original leaf-cluster cutout) clustered at branch tips, with normals bent outward from the canopy
centre so it lights as a soft volume.

Blender -b -P scripts/blender/create_tree.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402
import common as C  # noqa: E402


def grow(seed, height, spread, levels=3, roots=6):
    """Return skeleton verts [(co, radius)], edges, and branch tips [(co, size)]."""
    rnd = random.Random(seed)
    verts, edges, tips = [], [], []

    def add(co, r, parent=None):
        verts.append((Vector(co), r))
        i = len(verts) - 1
        if parent is not None:
            edges.append((parent, i))
        return i

    base = add((0, 0, -0.3), 0.55)
    # roots flare into the ground
    for k in range(roots):
        a = k / roots * math.tau + rnd.uniform(-0.3, 0.3)
        p = add((math.cos(a) * 0.55, math.sin(a) * 0.55, -0.05), 0.24, base)
        add((math.cos(a) * 1.25, math.sin(a) * 1.25, -0.35), 0.1, p)

    def limb(start_idx, start, direction, length, radius, level):
        segs = 5 if level == 0 else 4
        idx = start_idx
        co = start.copy()
        d = direction.normalized()
        for s in range(1, segs + 1):
            t = s / segs
            # gentle wander and upward reach
            d = (d + Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), 0.12 if level else 0.02))).normalized()
            co = co + d * (length / segs)
            r = radius * (1 - 0.75 * t) + 0.02
            idx = add(co, r, idx)
            if level < levels and s >= (3 if level == 0 else 1) and rnd.random() < (0.95 if level == 0 else 0.7):
                n = 2 if level == 0 else 1
                for _ in range(n):
                    side = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(0.25, 0.9)))
                    side = side.normalized() * spread + d * 0.4
                    limb(idx, co, side, length * rnd.uniform(0.55, 0.75), r * 0.68, level + 1)
            # foliage only along the outer, thinner limbs
            if level >= 2 or (level == 1 and t > 0.6):
                tips.append((co.copy(), 0.55 if level >= 2 else 0.7))
        return idx

    trunk_top = limb(base, Vector((0, 0, -0.3)), Vector((rnd.uniform(-0.1, 0.1), rnd.uniform(-0.1, 0.1), 1)), height * 0.62, 0.48, 0)
    void = trunk_top
    return verts, edges, tips


def skin_mesh(name, verts, edges):
    me = bpy.data.meshes.new(name)
    me.from_pydata([v for v, _ in verts], edges, [])
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    sk = o.modifiers.new("skin", "SKIN")
    sk.use_smooth_shade = True
    C.select_only(o)
    for i, (_, r) in enumerate(verts):
        o.data.skin_vertices[0].data[i].radius = (r, r)
    o.data.skin_vertices[0].data[0].use_root = True
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.levels = 1
    disp = C.displace(o, strength=0.05, scale=0.35, kind="CLOUDS", name=f"{name}_bark")
    disp.texture_coords = "LOCAL"
    C.apply_modifiers(o)
    C.shade_smooth(o, 70)
    return o


def foliage(name, tips, rnd, cards_per_tip, mat, centre, size_mul=1.0):
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    for co, size in tips:
        for _ in range(cards_per_tip):
            off = Vector((rnd.gauss(0, 0.42), rnd.gauss(0, 0.42), rnd.gauss(0.2, 0.3))) * size
            p = co + off
            s = rnd.uniform(0.5, 0.78) * size * size_mul
            rot = Matrix.Rotation(rnd.uniform(0, math.tau), 4, "Z") @ Matrix.Rotation(rnd.uniform(-0.9, 0.9), 4, "X")
            # two crossed quads per card so it reads from any angle
            for cross in (0, math.pi / 2):
                r2 = rot @ Matrix.Rotation(cross, 4, "Z")
                corners = [Vector((-s, 0, -s)), Vector((s, 0, -s)), Vector((s, 0, s)), Vector((-s, 0, s))]
                vs = [bm.verts.new(p + (r2 @ c.to_4d()).to_3d()) for c in corners]
                f = bm.faces.new(vs)
                for loop, (u, v) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                    loop[uv].uv = (u, v)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    # soft-volume normals: point outward from the canopy centre
    normals = []
    for loop in me.loops:
        v = me.vertices[loop.vertex_index].co
        n = (v - centre)
        n.z *= 0.7
        normals.append(n.normalized())
    me.normals_split_custom_set(normals)
    return o


def leaf_material():
    m = bpy.data.materials.new("tree_leaves")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    img = bpy.data.images.load(os.path.join(C.TEX_DIR, "leaf_cluster.png"))
    t = C.node(nt, "ShaderNodeTexImage", (-400, 200), image=img)
    nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
    b.inputs["Roughness"].default_value = 0.6
    m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
    m.surface_render_method = "DITHERED"
    return m


def decimated(o, name, ratio):
    c = o.copy()
    c.data = o.data.copy()
    c.name = name
    bpy.context.scene.collection.objects.link(c)
    d = c.modifiers.new("dec", "DECIMATE")
    d.ratio = ratio
    C.apply_modifiers(c)
    return c


def join(name, *objs):
    C.select_only(*objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    return o


def make_tree(name, seed, height, spread, cards, bark_size, lod_cards=0, trunk_ratio=1.0):
    """Returns [tree] or [tree, tree_lod1]. The LOD shares the skeleton and both materials: the trunk
    decimated, and far fewer, larger foliage cards, for the forest seen from a distance."""
    rnd = random.Random(seed * 7 + 1)
    verts, edges, tips = grow(seed, height, spread)
    wood = skin_mesh(f"{name}_wood", verts, edges)
    C.uv_unwrap(wood, margin=0.01, angle=60)
    wood.data.materials.append(C.ph_shader(f"{name}_bark_src", "bark_brown_02", scale=1.6, bump=0.9, bump_dist=0.02))
    col, rough, nrm = C.bake_maps(wood, None, size=bark_size, name=f"{name}_bark")
    # crevices: bake AO and darken the colour with it
    ao = C.new_image(f"{name}_bark_ao", bark_size, non_color=True)
    for slot in wood.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("__bake__")
        n.image = ao
        nt.nodes.active = n
    C.select_only(wood)
    bpy.context.scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type="AO", margin=8)
    px = list(col.pixels)
    aop = list(ao.pixels)
    for i in range(0, len(px), 4):
        k = 0.45 + 0.55 * aop[i]
        px[i] *= k
        px[i + 1] *= k
        px[i + 2] *= k
    col.pixels = px
    col.save()
    wood.data.materials.clear()
    wood.data.materials.append(C.baked_material(f"{name}_bark", col, rough, nrm))
    zs = [co.z for co, _ in tips]
    centre = Vector((sum(c.x for c, _ in tips) / len(tips), sum(c.y for c, _ in tips) / len(tips), sum(zs) / len(zs)))
    leaf_mat = leaf_material()
    out = []
    if lod_cards:
        wood_lod = decimated(wood, f"{name}_lod1_wood", 0.12)
        leaves_lod = foliage(f"{name}_lod1_leaves", tips, random.Random(seed), max(1, lod_cards // max(1, len(tips))), leaf_mat, centre, 1.9)
        lod = join(f"{name}_lod1", wood_lod, leaves_lod)
        C.log(f"{name}_lod1: {C.tri_count(lod)} tris")
        out.append(lod)
    if trunk_ratio < 1:
        # The bark bake already holds the fine relief, so the game trunk can be much lighter.
        d = wood.modifiers.new("dec", "DECIMATE")
        d.ratio = trunk_ratio
        C.apply_modifiers(wood)
    leaves = foliage(f"{name}_leaves", tips, rnd, max(2, cards // max(1, len(tips))), leaf_mat, centre)
    # one object per tree: wood + leaves joined (two materials), origin at the ground
    tree = join(name, wood, leaves)
    xs = [v.co.x for v in tree.data.vertices]
    ys = [v.co.y for v in tree.data.vertices]
    zs = [v.co.z for v in tree.data.vertices]
    C.log(f"{name}: {C.tri_count(tree)} tris, {height:.0f}u, {len(tips)} tips, bbox z {min(zs):.2f}..{max(zs):.2f}")
    # origin stays at the trunk base (roots dip slightly below)
    return [tree, *out]


def main():
    C.reset_scene()
    bpy.context.scene.cycles.samples = 32
    [great] = make_tree("great_tree", 3, 7.5, 1.05, 1800, 1024, trunk_ratio=0.3)
    meadow, meadow_lod = make_tree("meadow_tree", 11, 4.6, 0.85, 700, 512, lod_cards=110, trunk_ratio=0.35)
    meadow.location.x = 8
    meadow_lod.location.x = 16
    C.save_blend("vegetation/trees.blend")
    meadow.location.x = meadow_lod.location.x = 0
    C.export_glb("tree", [great, meadow, meadow_lod])
    C.done()


main()
