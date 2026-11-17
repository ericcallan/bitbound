"""
Ground cover for the valley, made to be instanced thousands of times: a grass clump (curved, tapered
blades), a tall-grass tuft, two wildflowers and a fern. Shaded by vertex colour (root-to-tip gradients,
per-blade hue variation) so they need no textures and cost one draw call per type.

Blender -b -P scripts/blender/create_vegetation.py
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import bmesh  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402


def vc_material(name, rough=0.75):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    a = C.node(nt, "ShaderNodeVertexColor", (-400, 200))
    a.layer_name = "Col"
    nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    return m


def blade(bm, col, root, height, width, lean, yaw, c0, c1, segs=3):
    """A tapered, curved blade (two-sided by material), coloured root → tip."""
    prev = None
    d = Vector((math.cos(yaw), math.sin(yaw), 0))
    side = Vector((-d.y, d.x, 0))
    for i in range(segs + 1):
        t = i / segs
        w = width * (1 - t) ** 0.9 * 0.5 + 0.0015
        p = root + d * (lean * t * t * height) + Vector((0, 0, height * t))
        a = bm.verts.new(p - side * w)
        b = bm.verts.new(p + side * w)
        if prev:
            f = bm.faces.new((prev[0], prev[1], b, a))
            for loop in f.loops:
                tt = (loop.vert.co.z - root.z) / max(1e-4, height)
                loop[col] = tuple(c0[k] + (c1[k] - c0[k]) * tt for k in range(3)) + (1.0,)
        prev = (a, b)


def mesh_from(name, build, mat):
    bm = bmesh.new()
    col = bm.loops.layers.color.new("Col")
    build(bm, col)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    me.materials.append(mat)
    return o


def grass_clump(bm, col, rnd=random.Random(5), n=18, h=0.45, spread=0.18):
    for _ in range(n):
        r = rnd.random() ** 0.5 * spread
        a = rnd.uniform(0, math.tau)
        root = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        hue = rnd.uniform(-0.04, 0.04)
        c0 = (0.06 + hue, 0.16, 0.03)
        c1 = (0.32 + hue * 2, 0.55 + rnd.uniform(-0.06, 0.06), 0.12)
        blade(bm, col, root, h * rnd.uniform(0.6, 1.15), rnd.uniform(0.028, 0.045), rnd.uniform(0.15, 0.45), a + rnd.uniform(-0.6, 0.6), c0, c1)


def tall_tuft(bm, col):
    grass_clump(bm, col, random.Random(9), n=16, h=0.85, spread=0.12)


def flower(bm, col, petal, centre, seed):
    rnd = random.Random(seed)
    for k in range(3):
        a = rnd.uniform(0, math.tau)
        r = rnd.uniform(0.02, 0.12)
        base = Vector((math.cos(a) * r, math.sin(a) * r, 0))
        h = rnd.uniform(0.32, 0.5)
        blade(bm, col, base, h, 0.012, rnd.uniform(0.05, 0.2), a, (0.08, 0.2, 0.04), (0.2, 0.42, 0.08), segs=3)
        top = base + Vector((0, 0, h))
        n = 6
        for i in range(n):
            ang = i / n * math.tau + rnd.uniform(-0.1, 0.1)
            dvec = Vector((math.cos(ang), math.sin(ang), 0.25))
            p0 = bm.verts.new(top)
            p1 = bm.verts.new(top + dvec * 0.06 + Vector((-dvec.y, dvec.x, 0)) * 0.025)
            p2 = bm.verts.new(top + dvec * 0.09)
            p3 = bm.verts.new(top + dvec * 0.06 - Vector((-dvec.y, dvec.x, 0)) * 0.025)
            f = bm.faces.new((p0, p1, p2, p3))
            for loop in f.loops:
                loop[col] = (*petal, 1.0) if loop.vert is not p0 else (*centre, 1.0)
        # a disc for the flower centre
        c = [bm.verts.new(top + Vector((math.cos(i / 6 * math.tau) * 0.02, math.sin(i / 6 * math.tau) * 0.02, 0.012))) for i in range(6)]
        f = bm.faces.new(c)
        for loop in f.loops:
            loop[col] = (*centre, 1.0)


def fern(bm, col):
    rnd = random.Random(21)
    for i in range(9):
        a = i / 9 * math.tau + rnd.uniform(-0.2, 0.2)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        length = rnd.uniform(0.45, 0.7)
        prev = None
        for s in range(7):
            t = s / 6
            p = d * length * t + Vector((0, 0, 0.32 * math.sin(t * math.pi * 0.8)))
            w = 0.09 * math.sin(t * math.pi) + 0.004
            a1 = bm.verts.new(p - side * w)
            b1 = bm.verts.new(p + side * w)
            if prev:
                f = bm.faces.new((prev[0], prev[1], b1, a1))
                for loop in f.loops:
                    tt = loop.vert.co.length / max(0.01, length)
                    loop[col] = (0.05 + 0.1 * tt, 0.18 + 0.22 * tt, 0.04, 1.0)
            prev = (a1, b1)


def paint_faces(bm, col, faces, c):
    for f in faces:
        for loop in f.loops:
            loop[col] = (*c, 1.0)


def pebbles(bm, col):
    """A little scatter of river pebbles (low-poly ellipsoids), grey-brown with lighter tops."""
    rnd = random.Random(31)
    for _ in range(5):
        r = rnd.uniform(0.025, 0.065)
        centre = Vector((rnd.gauss(0, 0.18), rnd.gauss(0, 0.18), r * 0.3))
        res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=r)
        for v in res["verts"]:
            v.co.z *= rnd.uniform(0.45, 0.7)
            v.co.x *= rnd.uniform(0.9, 1.3)
            v.co += centre
        g = rnd.uniform(0.5, 0.7)
        base = (g, g * 0.93, g * 0.84)
        for f in {f for v in res["verts"] for f in v.link_faces}:
            up = f.normal.z if f.normal.length > 0 else 0
            k = 0.8 + 0.25 * max(0.0, up)
            for loop in f.loops:
                loop[col] = (base[0] * k, base[1] * k, base[2] * k, 1.0)


def twigs(bm, col):
    """Fallen twigs: thin, slightly bent four-sided sticks with a fork."""
    rnd = random.Random(41)
    for _ in range(3):
        a = rnd.uniform(0, math.tau)
        d = Vector((math.cos(a), math.sin(a), 0))
        start = Vector((rnd.gauss(0, 0.12), rnd.gauss(0, 0.12), 0.012))
        length = rnd.uniform(0.25, 0.45)
        stick(bm, col, start, d, length, 0.011, rnd)
        fork = start + d * length * 0.55
        side = Vector((-d.y, d.x, 0)) * rnd.choice((-1, 1))
        stick(bm, col, fork, (d + side * 0.8).normalized(), length * 0.4, 0.007, rnd)


def stick(bm, col, start, d, length, r, rnd):
    side = Vector((-d.y, d.x, 0))
    segs = 3
    rings = []
    for i in range(segs + 1):
        t = i / segs
        c = start + d * length * t + Vector((0, 0, math.sin(t * math.pi) * 0.015)) + side * math.sin(t * 3) * 0.01
        rr = r * (1 - 0.5 * t)
        ring = [bm.verts.new(c + side * math.cos(k / 4 * math.tau) * rr + Vector((0, 0, math.sin(k / 4 * math.tau) * rr))) for k in range(4)]
        rings.append(ring)
    bark = (0.24, 0.16, 0.09)
    for a, b in zip(rings, rings[1:]):
        for k in range(4):
            f = bm.faces.new((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]))
            paint_faces(bm, col, [f], bark)


def leaf_litter(bm, col):
    """Fallen leaves: small curled diamonds in autumn and dry-green tones, lying flat."""
    rnd = random.Random(51)
    # linear vertex colours (shown as sRGB they're about twice as bright): dry ochre, rust, faded green
    tones = [(0.62, 0.38, 0.12), (0.5, 0.26, 0.08), (0.7, 0.52, 0.2), (0.42, 0.44, 0.16), (0.58, 0.28, 0.1)]
    for _ in range(10):
        c = Vector((rnd.gauss(0, 0.2), rnd.gauss(0, 0.2), 0.006))
        a = rnd.uniform(0, math.tau)
        d = Vector((math.cos(a), math.sin(a), 0))
        side = Vector((-d.y, d.x, 0))
        L = rnd.uniform(0.03, 0.055)
        W = L * 0.42
        # a leaf shape (tip, two shoulders, stem end) with its edges curled up and its middle on the ground
        curl = Vector((0, 0, L * 0.35))
        mid = bm.verts.new(c)
        ring = [
            bm.verts.new(c - d * L),
            bm.verts.new(c - d * L * 0.3 + side * W + curl),
            bm.verts.new(c + d * L * 0.4 + side * W * 0.8 + curl),
            bm.verts.new(c + d * L + curl * 0.4),
            bm.verts.new(c + d * L * 0.4 - side * W * 0.8 + curl),
            bm.verts.new(c - d * L * 0.3 - side * W + curl),
        ]
        tone = rnd.choice(tones)
        for i in range(6):
            f = bm.faces.new((mid, ring[i], ring[(i + 1) % 6]))
            for loop in f.loops:
                k = 0.9 if loop.vert is mid else 1.05
                loop[col] = (tone[0] * k, tone[1] * k, tone[2] * k, 1.0)


def clover(bm, col):
    """A low clover patch: many three-leaf sprigs on short stems."""
    rnd = random.Random(61)
    for _ in range(9):
        base = Vector((rnd.gauss(0, 0.13), rnd.gauss(0, 0.13), 0))
        h = rnd.uniform(0.05, 0.11)
        blade(bm, col, base, h, 0.008, 0.1, rnd.uniform(0, math.tau), (0.1, 0.22, 0.05), (0.2, 0.4, 0.1), segs=2)
        top = base + Vector((0, 0, h))
        for k in range(3):
            a = k / 3 * math.tau + rnd.uniform(-0.2, 0.2)
            d = Vector((math.cos(a), math.sin(a), 0.15))
            side = Vector((-d.y, d.x, 0))
            vs = [bm.verts.new(top), bm.verts.new(top + d * 0.03 + side * 0.022), bm.verts.new(top + d * 0.05), bm.verts.new(top + d * 0.03 - side * 0.022)]
            f = bm.faces.new(vs)
            g = rnd.uniform(0.85, 1.1)
            for loop in f.loops:
                loop[col] = (0.16 * g, 0.42 * g, 0.12 * g, 1.0)


def thistle(bm, col):
    """A wild thistle: a few tall stems with spiky leaves and violet heads."""
    rnd = random.Random(71)
    for _ in range(3):
        base = Vector((rnd.gauss(0, 0.08), rnd.gauss(0, 0.08), 0))
        h = rnd.uniform(0.55, 0.8)
        yaw = rnd.uniform(0, math.tau)
        blade(bm, col, base, h, 0.018, 0.08, yaw, (0.12, 0.2, 0.08), (0.24, 0.36, 0.14), segs=4)
        for k in range(4):
            t = 0.2 + k * 0.15
            p = base + Vector((0, 0, h * t))
            a = yaw + k * 2.1
            d = Vector((math.cos(a), math.sin(a), 0.3))
            side = Vector((-d.y, d.x, 0))
            L = 0.16 * (1 - t * 0.6)
            vs = [bm.verts.new(p), bm.verts.new(p + d * L * 0.5 + side * L * 0.25), bm.verts.new(p + d * L), bm.verts.new(p + d * L * 0.5 - side * L * 0.2)]
            f = bm.faces.new(vs)
            paint_faces(bm, col, [f], (0.2, 0.32, 0.13))
        top = base + Vector((0, 0, h))
        res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.035)
        for v in res["verts"]:
            v.co += top
        for f in {f for v in res["verts"] for f in v.link_faces}:
            up = f.normal.z
            c = (0.55, 0.3, 0.78) if up > 0.1 else (0.2, 0.32, 0.13)
            for loop in f.loops:
                loop[col] = (*c, 1.0)


def main():
    C.reset_scene()
    mat = vc_material("vegetation_vc")
    objs = [
        mesh_from("grass_clump", lambda bm, col: grass_clump(bm, col), mat),
        mesh_from("tall_grass", tall_tuft, mat),
        mesh_from("flower_white", lambda bm, col: flower(bm, col, (0.95, 0.93, 0.85), (0.95, 0.75, 0.15), 3), mat),
        mesh_from("flower_violet", lambda bm, col: flower(bm, col, (0.55, 0.35, 0.85), (0.98, 0.85, 0.3), 4), mat),
        mesh_from("fern", fern, mat),
        # Beyond: ground detail and more plant variety near the path
        mesh_from("pebbles", pebbles, mat),
        mesh_from("twigs", twigs, mat),
        mesh_from("leaf_litter", leaf_litter, mat),
        mesh_from("clover", clover, mat),
        mesh_from("thistle", thistle, mat),
    ]
    for o in objs:
        C.shade_smooth(o, 80)
        C.log(f"{o.name}: {len(o.data.polygons) * 2} tris")
    C.save_blend("vegetation/ground_cover.blend")
    C.export_glb("vegetation", objs)
    C.done()


main()
