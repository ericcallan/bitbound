"""
Trees for the valley: the signature Great Tree and the meadow tree, in the art bible's silhouettes
(docs/ART_BIBLE.md §4): a crown of three rounded masses on a slightly leaning trunk, the same shape in every
generation.

Trunk and limbs grow from a skeleton (base, roots, a leaning trunk forking into one limb per canopy mass) turned
into one mesh by the Skin modifier. Bark is the painted bark material, baked with Cycles ambient occlusion. The
canopy is crossed foliage cards (original leaf-cluster cutout) gathered in clumps inside the three masses, each
card's normal pointing out of its own mass, so each mass lights as a soft round volume.

Per tree, also:
  <tree>_shell   the three masses as one smooth mesh, plus a light trunk (Stylized; cheap shadow caster)
  <tree>_low     three faceted icospheres on a six-sided trunk (Early 3D)

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


def leaf_material():
    m = bpy.data.materials.new("tree_leaves")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    img = bpy.data.images.load(os.path.join(C.TEX_DIR, "leaf_cluster.png"))
    t = C.node(nt, "ShaderNodeTexImage", (-400, 200), image=img)
    # each mass darker toward its underside and core (the "shade" colour attribute; exported as COLOR_0)
    ca = C.node(nt, "ShaderNodeVertexColor", (-400, 450))
    ca.layer_name = "shade"
    mul = C.node(nt, "ShaderNodeMix", (-150, 300))
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(t.outputs["Color"], mul.inputs["A"])
    nt.links.new(ca.outputs["Color"], mul.inputs["B"])
    nt.links.new(mul.outputs["Result"], b.inputs["Base Color"])
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


# Canopy masses as fractions of the tree's height: (x, depth, up, rx, rdepth, rup). From the bible silhouette.
MEADOW = [(-0.17, 0.05, 0.52, 0.235, 0.2, 0.186), (0.16, -0.06, 0.56, 0.245, 0.21, 0.196), (-0.01, 0.0, 0.775, 0.265, 0.23, 0.225)]
GREAT = [(-0.36, 0.05, 0.6, 0.22, 0.2, 0.16), (0.36, -0.05, 0.62, 0.22, 0.2, 0.16), (0.0, 0.0, 0.8, 0.36, 0.28, 0.2)]


def scaled(masses, h):
    return [(Vector((x * h, y * h, z * h)), Vector((rx * h, ry * h, rz * h))) for x, y, z, rx, ry, rz in masses]


def grow_masses(seed, h, masses, lean=0.04, fork=0.42, roots=6, root_len=1.25):
    """Skeleton verts [(co, radius)] and edges: roots, a leaning trunk to the fork, one limb into each mass."""
    rnd = random.Random(seed)
    verts, edges = [], []

    def add(co, r, parent=None):
        verts.append((Vector(co), r))
        i = len(verts) - 1
        if parent is not None:
            edges.append((parent, i))
        return i

    r0 = 0.065 * h
    base = add((0, 0, -0.3), r0 * 1.15)
    for k in range(roots):
        a = k / roots * math.tau + rnd.uniform(-0.3, 0.3)
        p = add((math.cos(a) * r0 * 1.1, math.sin(a) * r0 * 1.1, -0.05), r0 * 0.5, base)
        add((math.cos(a) * root_len * h / 4.6, math.sin(a) * root_len * h / 4.6, -0.35), r0 * 0.2, p)
    # the trunk leans a little and curves back (the bible's "slightly leaning trunk")
    idx = base
    segs = 5
    for sgm in range(1, segs + 1):
        t = sgm / segs
        co = Vector((math.sin(t * math.pi * 0.8) * lean * h, 0, -0.3 + t * (fork * h + 0.3)))
        idx = add(co, r0 * (1 - 0.35 * t), idx)
    fork_i, fork_co = idx, verts[idx][0]
    for centre, rad in masses:
        # a limb from the fork to inside the mass, then twigs fanning out within it
        li = fork_i
        target = centre - Vector((0, 0, rad.z * 0.35))
        for sgm in range(1, 4):
            t = sgm / 3
            co = fork_co.lerp(target, t) + Vector((rnd.uniform(-0.08, 0.08), rnd.uniform(-0.08, 0.08), math.sin(t * math.pi) * 0.04 * h))
            li = add(co, r0 * (0.62 - 0.32 * t), li)
        for _ in range(5):
            d = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-0.2, 1))).normalized()
            tip = centre + Vector((d.x * rad.x, d.y * rad.y, d.z * rad.z)) * 0.65
            mid = target.lerp(tip, 0.5)
            m = add(mid, r0 * 0.16, li)
            add(tip, r0 * 0.07, m)
    return verts, edges


def inside(p, centre, rad):
    """How deep `p` is in an ellipsoid: 0 at the centre, 1 on the surface."""
    d = p - centre
    return (d.x / rad.x) ** 2 + (d.y / rad.y) ** 2 + (d.z / rad.z) ** 2


def foliage_masses(name, masses, rnd, cards, mat, size, size_mul=1.0):
    """Crossed cards in clumps inside each mass, biased to its surface; normals point out of the card's own mass."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new("UVMap")
    owners = []
    vol = [r.x * r.y * r.z for _, r in masses]
    for (centre, rad), v in zip(masses, vol):
        n_cards = max(6, int(cards * v / sum(vol)))
        n_clumps = max(2, n_cards // 6)
        for _ in range(n_clumps):
            d = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
            k = rnd.random() ** 0.18 * 0.86
            if d.z < -0.4:
                k *= 0.82  # a flatter underside
            clump = centre + Vector((d.x * rad.x, d.y * rad.y, d.z * rad.z)) * k
            # a clump buried inside a neighbouring mass is never seen, and blurs the gap between masses
            if any(o is not centre and inside(clump, o, r) < 0.55 for o, r in masses):
                continue
            for _ in range(6):
                p = clump + Vector((rnd.gauss(0, 0.2), rnd.gauss(0, 0.2), rnd.gauss(0, 0.17))) * size
                s = rnd.uniform(0.5, 0.78) * size * size_mul
                rot = Matrix.Rotation(rnd.uniform(0, math.tau), 4, "Z") @ Matrix.Rotation(rnd.uniform(-0.9, 0.9), 4, "X")
                for cross in (0, math.pi / 2):
                    r2 = rot @ Matrix.Rotation(cross, 4, "Z")
                    corners = [Vector((-s, 0, -s)), Vector((s, 0, -s)), Vector((s, 0, s)), Vector((-s, 0, s))]
                    vs = [bm.verts.new(p + (r2 @ c.to_4d()).to_3d()) for c in corners]
                    f = bm.faces.new(vs)
                    for loop, (u, w) in zip(f.loops, [(0, 0), (1, 0), (1, 1), (0, 1)]):
                        loop[uv].uv = (u, w)
                    owners.append((centre, rad))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    normals = []
    for poly, (centre, rad) in zip(me.polygons, owners):
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            n = Vector(((v.x - centre.x) / rad.x, (v.y - centre.y) / rad.y, (v.z - centre.z) / rad.z * 0.85))
            normals.append(n.normalized())
    me.normals_split_custom_set(normals)
    # shade per corner: darker low in each mass and deep inside it, so the three masses separate
    shade = me.color_attributes.new("shade", "BYTE_COLOR", "CORNER")
    for poly, (centre, rad) in zip(me.polygons, owners):
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index].co
            up = max(-1.0, min(1.0, (v.z - centre.z) / rad.z))
            depth = min(1.0, inside(v, centre, rad))
            k = (0.5 + 0.5 * (up * 0.5 + 0.5) ** 0.8) * (0.72 + 0.28 * depth)
            shade.data[li].color = (k, k, k, 1.0)
    return o


def unshaded(o):
    """Give a mesh joined with the foliage a white "shade" attribute (otherwise it would default to black)."""
    a = o.data.color_attributes.new("shade", "BYTE_COLOR", "CORNER")
    for d in a.data:
        d.color = (1.0, 1.0, 1.0, 1.0)
    return o


def flat_material(name, hex_colour, rough=0.85):
    return C.principled(name, base=C._lin(hex_colour)[:3], rough=rough)


def shell(name, masses, wood, h):
    """The canopy as one smooth, slightly lumpy surface (spheres united by a voxel remesh), on a light trunk."""
    parts = []
    for centre, rad in masses:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=centre)
        o = bpy.context.active_object
        o.scale = rad
        parts.append(o)
    can = join(f"{name}_canopy", *parts)
    C.select_only(can)
    bpy.ops.object.transform_apply(scale=True)
    rm = can.modifiers.new("rm", "REMESH")
    rm.mode = "VOXEL"
    rm.voxel_size = 0.035 * h
    sm = can.modifiers.new("sm", "SMOOTH")
    sm.iterations = 4
    sm.factor = 0.8
    C.displace(can, strength=0.035 * h, scale=0.16 * h, name=f"{name}_lumps")
    dec = can.modifiers.new("dec", "DECIMATE")
    dec.ratio = 0.12
    C.apply_modifiers(can)
    C.shade_smooth(can, 60)
    can.data.materials.clear()
    can.data.materials.append(flat_material(f"{name}_leaf", "#5e7f45"))
    trunk = decimated(wood, f"{name}_trunk", 0.08)
    trunk.data.materials.clear()
    trunk.data.materials.append(flat_material(f"{name}_bark", "#5a3d2b"))
    out = join(name, can, trunk)
    C.log(f"{name}: {C.tri_count(out)} tris")
    return out


def low_poly(name, masses, h, lean, fork, seed):
    """Early 3D: three faceted icospheres on a six-sided trunk, three four-sided limbs. Flat colours."""
    rnd = random.Random(seed)
    leaf = flat_material(f"{name}_leaf", "#5e7f45", 0.9)
    bark = flat_material(f"{name}_bark", "#5a3d2b", 0.9)
    parts = []
    for centre, rad in masses:
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=centre)
        o = bpy.context.active_object
        o.scale = rad * 1.02
        o.rotation_euler = (rnd.uniform(0, 1), rnd.uniform(0, 1), rnd.uniform(0, 6.28))
        for v in o.data.vertices:
            v.co *= rnd.uniform(0.92, 1.06)
        o.data.materials.append(leaf)
        parts.append(o)
    top = Vector((math.sin(math.pi * 0.8) * lean * h, 0, fork * h))
    bpy.ops.mesh.primitive_cone_add(vertices=6, radius1=0.075 * h, radius2=0.045 * h, depth=fork * h + 0.2, location=(top.x / 2, 0, (fork * h - 0.2) / 2))
    t = bpy.context.active_object
    t.data.materials.append(bark)
    parts.append(t)
    for centre, rad in masses:
        d = (centre - top)
        bpy.ops.mesh.primitive_cone_add(vertices=4, radius1=0.035 * h, radius2=0.018 * h, depth=d.length, location=top + d / 2)
        limb = bpy.context.active_object
        limb.rotation_mode = "QUATERNION"
        limb.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
        limb.data.materials.append(bark)
        parts.append(limb)
    for o in parts:
        C.select_only(o)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    out = join(name, *parts)
    for poly in out.data.polygons:
        poly.use_smooth = False
    C.log(f"{name}: {C.tri_count(out)} tris")
    return out


def make_tree(name, seed, h, masses, cards, bark_size, leaf_size, lod_cards=0, trunk_ratio=1.0, lean=0.04, fork=0.42, roots=6, root_len=1.25):
    """Returns [tree, shell, low] or [tree, tree_lod1, shell, low]."""
    rnd = random.Random(seed * 7 + 1)
    ms = scaled(masses, h)
    verts, edges = grow_masses(seed, h, ms, lean, fork, roots, root_len)
    wood = skin_mesh(f"{name}_wood", verts, edges)
    C.uv_unwrap(wood, margin=0.01, angle=60)
    wood.data.materials.append(C.painted_shader(f"{name}_bark_src", "bark", scale=1.6, bump=0.9, bump_dist=0.02))
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
    leaf_mat = leaf_material()
    sh = shell(f"{name}_shell", ms, wood, h)
    low = low_poly(f"{name}_low", ms, h, lean, fork, seed)
    out = []
    if lod_cards:
        wood_lod = decimated(wood, f"{name}_lod1_wood", 0.12)
        leaves_lod = foliage_masses(f"{name}_lod1_leaves", ms, random.Random(seed), lod_cards, leaf_mat, leaf_size, 1.9)
        lod = join(f"{name}_lod1", unshaded(wood_lod), leaves_lod)
        C.log(f"{name}_lod1: {C.tri_count(lod)} tris")
        out.append(lod)
    if trunk_ratio < 1:
        # The bark bake already holds the fine relief, so the game trunk can be much lighter.
        d = wood.modifiers.new("dec", "DECIMATE")
        d.ratio = trunk_ratio
        C.apply_modifiers(wood)
    leaves = foliage_masses(f"{name}_leaves", ms, rnd, cards, leaf_mat, leaf_size)
    tree = join(name, unshaded(wood), leaves)
    zs = [v.co.z for v in tree.data.vertices]
    C.log(f"{name}: {C.tri_count(tree)} tris, {h:.1f}u, bbox z {min(zs):.2f}..{max(zs):.2f}")
    return [tree, *out, sh, low]


def main():
    C.reset_scene()
    bpy.context.scene.cycles.samples = 32
    great, great_shell, great_low = make_tree("great_tree", 3, 7.5, GREAT, 1800, 1024, 1.0, trunk_ratio=0.3, lean=0.02, fork=0.4, roots=8, root_len=1.7)
    meadow, meadow_lod, meadow_shell, meadow_low = make_tree("meadow_tree", 11, 4.6, MEADOW, 700, 512, 0.7, lod_cards=110, trunk_ratio=0.35)
    objs = [great, meadow, meadow_lod, meadow_shell, meadow_low, great_shell, great_low]
    for i, o in enumerate(objs):
        o.location.x = i * 9
    C.save_blend("vegetation/trees.blend")
    for o in objs:
        o.location.x = 0
    C.export_glb("tree", objs)
    C.done()


main()
