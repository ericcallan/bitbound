"""
The valley terrain: one continuous mesh built from the game's own height field
(scripts/terrain/export-valley.ts → assets/source-textures/valley_grid.json), so what you see and
what you walk on agree exactly.

Per-vertex colour carries the material weights the runtime terrain shader blends
(R rock, G worn path, B forest floor; grass is the remainder) and A carries ambient occlusion baked
here in Cycles, so hollows, gorge walls and the foot of cliffs darken naturally.

Game (x, y-up, z) maps to Blender (x, -z, y); the glTF exporter maps it back.

npx vite-node scripts/terrain/export-valley.ts && Blender -b -P scripts/blender/create_terrain.py
"""
import base64
import json
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import common as C  # noqa: E402


def load_grid():
    p = os.path.join(C.TEX_DIR, "valley_grid.json")
    if not os.path.exists(p):
        raise FileNotFoundError("run: npx vite-node scripts/terrain/export-valley.ts")
    d = json.load(open(p))
    xs, zs = d["xs"], d["zs"]
    nx, nz = len(xs), len(zs)
    raw = base64.b64decode(d["heights"])
    h = struct.unpack(f"<{nx * nz}f", raw)
    splat = base64.b64decode(d["splat"])
    return xs, zs, h, splat


def build_mesh(xs, zs, h):
    nx, nz = len(xs), len(zs)
    verts = [(xs[i], -zs[j], h[j * nx + i]) for j in range(nz) for i in range(nx)]
    faces = []
    for j in range(nz - 1):
        for i in range(nx - 1):
            a = j * nx + i
            # counter-clockwise seen from above (Blender +Z), so faces point up
            faces.append((a, a + nx, a + nx + 1, a + 1))
    me = bpy.data.meshes.new("valley_terrain")
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new("valley_terrain", me)
    bpy.context.scene.collection.objects.link(o)
    return o


def main():
    C.reset_scene()
    scene = bpy.context.scene
    scene.cycles.samples = 64
    xs, zs, h, splat = load_grid()
    o = build_mesh(xs, zs, h)
    C.log(f"terrain {len(o.data.vertices)} verts, {len(o.data.polygons) * 2} tris")
    # Smooth shading, but keep crisp creases where the gorge walls and lane edges drop.
    C.shade_smooth(o, 55)
    # AO: bake into a temporary colour attribute, then fold it into the splat alpha.
    mat = C.principled("terrain_bake", (0.6, 0.6, 0.6), 0.9)
    o.data.materials.append(mat)
    ao = o.data.color_attributes.new("ao", "BYTE_COLOR", "POINT")
    o.data.color_attributes.active_color = ao
    scene.render.bake.target = "VERTEX_COLORS"
    scene.render.bake.use_selected_to_active = False
    scene.world = bpy.data.worlds.new("sky")
    scene.world.use_nodes = True
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    C.select_only(o)
    bpy.ops.object.bake(type="AO")
    C.log("baked ambient occlusion into vertex colours")
    sp = o.data.color_attributes.new("splat", "BYTE_COLOR", "POINT")
    aod = ao.data
    spd = sp.data
    for i in range(len(spd)):
        k = i * 3
        a = aod[i].color[0]
        # sRGB-encoded byte colours: store linear-ish weights by writing color_srgb.
        spd[i].color_srgb = (splat[k] / 255, splat[k + 1] / 255, splat[k + 2] / 255, max(0.0, min(1.0, a)))
    o.data.color_attributes.remove(ao)
    o.data.color_attributes.active_color = o.data.color_attributes["splat"]
    o.data.color_attributes.render_color_index = 0
    # The exported material is a placeholder: the game replaces it with the splat terrain shader.
    o.data.materials.clear()
    o.data.materials.append(C.principled("valley_terrain_mat", (0.35, 0.45, 0.22), 0.9))
    C.save_blend("environments/valley_terrain.blend")
    os.makedirs(C.EXPORT_DIR, exist_ok=True)
    p = os.path.join(C.EXPORT_DIR, "terrain.glb")
    C.select_only(o)
    bpy.ops.export_scene.gltf(
        filepath=p,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
    )
    C.log("exported", os.path.relpath(p, C.ROOT), f"{os.path.getsize(p) / 1024:.0f} KB")
    C.done()


main()
