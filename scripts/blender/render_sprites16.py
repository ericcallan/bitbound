"""
Pre-render the 16-bit sprites from the Blender assets, the way mid-90s games did: side-on, orthographic,
lit from the upper left, on a transparent background, at 8x the final size. scripts/textures/sprites16.mjs
then reduces them to 24 px per world unit and a small palette and packs the sheet.

  Pip: idle, four walk frames and a jump frame, turned three-quarters to the right as in the 2D game.
  Scenery: meadow tree, fern (bush), mushroom cluster, signpost, ruined column, Shard arch, rock.

Blender -b -P scripts/blender/render_sprites16.py   → assets/previews/sprites16_raw/*.png + sprites16_raw.json
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

PPU = 24 * 8  # render pixels per world unit (final 24, rendered 8x)
OUT = os.path.join(C.ROOT, "assets", "previews", "sprites16_raw")
os.makedirs(OUT, exist_ok=True)

PIP_YAW = 0.6  # three-quarters toward +x, facing the 2D camera (found by test renders)

SPECS = [
    {"name": "pip_idle", "glb": "pip", "anim": "idle", "t": 0.0, "yaw": PIP_YAW},
    *[{"name": f"pip_walk{i}", "glb": "pip", "anim": "walk", "t": i / 4, "yaw": PIP_YAW} for i in range(4)],
    {"name": "pip_jump", "glb": "pip", "anim": "jump_up", "t": 0.5, "yaw": PIP_YAW},
    {"name": "tree", "glb": "tree", "node": "meadow_tree"},
    {"name": "bush", "glb": "vegetation", "node": "fern", "scale": 2.2},
    {"name": "mushroom", "glb": "props", "node": "mushroom_cluster", "scale": 1.15},
    {"name": "sign", "glb": "props", "node": "signpost"},
    {"name": "pillar", "glb": "gateway", "node": "ruin_column"},
    {"name": "arch", "glb": "gateway", "node": "shard_arch"},
    {"name": "rock", "glb": "rocks", "node": "rock_a"},
]


def paint_face(img):
    """The live screen-face, as a still: two bright eyes on the dark display."""
    w, h = img.size
    px = [0.0] * (w * h * 4)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            u, v = x / w, y / h
            eye = any(abs(u - cx) < 0.07 and abs(v - 0.5) < 0.13 for cx in (0.36, 0.64))
            # under the tinted faceplate: a near-black screen and white eyes read clearly at sprite size
            c = (1.0, 1.0, 1.0) if eye else (0.0, 0.0, 0.02)
            px[i : i + 4] = [c[0], c[1], c[2], 1.0]
    img.pixels = px


def setup_scene():
    C.reset_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.75, 0.82, 0.95, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    # key light from the upper left, toward the camera
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(55), math.radians(-35), math.radians(-20)))
    bpy.context.active_object.data.energy = 3.2
    bpy.context.active_object.data.color = (1.0, 0.95, 0.86)
    return scene


def render(spec):
    scene = setup_scene()
    bpy.ops.import_scene.gltf(filepath=os.path.join(C.EXPORT_DIR, f"{spec['glb']}.glb"))
    objs = list(scene.objects)
    meshes = [o for o in objs if o.type == "MESH"]
    if "node" in spec:
        keep = {spec["node"]}
        for o in meshes:
            if o.name not in keep and o.parent is None:
                bpy.data.objects.remove(o)
        meshes = [o for o in scene.objects if o.type == "MESH"]
    C.wire_vertex_shade(meshes)
    # turn and scale everything about the world origin (the importer's roots carry their own axis fix-ups)
    pivot = bpy.data.objects.new("pivot", None)
    scene.collection.objects.link(pivot)
    for r in [o for o in scene.objects if o.parent is None and o is not pivot and o.type in {"MESH", "ARMATURE", "EMPTY"}]:
        r.parent = pivot
    pivot.rotation_euler = (0, 0, spec.get("yaw", 0.0))
    s = spec.get("scale", 1.0)
    pivot.scale = (s, s, s)
    if "anim" in spec:
        act = bpy.data.actions.get(spec["anim"])
        for o in scene.objects:
            if o.type == "ARMATURE" and act:
                o.animation_data_create()
                o.animation_data.action = act
                f0, f1 = act.frame_range
                scene.frame_set(int(round(f0 + (f1 - f0) * spec["t"])))
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            if m and m.name.startswith("pip_face"):
                for n in m.node_tree.nodes:
                    if n.type == "TEX_IMAGE" and n.image:
                        paint_face(n.image)
    bpy.context.view_layer.update()
    # world-space bounds of what will be drawn
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    dg = bpy.context.evaluated_depsgraph_get()
    for o in scene.objects:
        if o.type != "MESH":
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            lo = Vector(map(min, lo, p))
            hi = Vector(map(max, hi, p))
        ev.to_mesh_clear()
    pad = 0.04
    lo -= Vector((pad, pad, pad))
    hi += Vector((pad, pad, pad))
    wx = hi.x - lo.x
    hz = hi.z - lo.z
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    cam.ortho_scale = max(wx, hz)
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    # game +z (toward the 2D camera) is Blender -y
    co.location = Vector(((lo.x + hi.x) / 2, lo.y - 20, (lo.z + hi.z) / 2))
    co.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = co
    scene.render.resolution_x = max(8, round(wx * PPU))
    scene.render.resolution_y = max(8, round(hz * PPU))
    out = os.path.join(OUT, f"{spec['name']}.png")
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    C.log(spec["name"], scene.render.resolution_x, "x", scene.render.resolution_y)
    # anchor: where the object's origin (ground) sits, in world units from the image's bottom-left
    return {"name": spec["name"], "w": wx, "h": hz, "originX": -lo.x, "originY": -lo.z}


def main():
    meta = [render(s) for s in SPECS]
    with open(os.path.join(OUT, "sprites16_raw.json"), "w") as f:
        json.dump(meta, f, indent=1)
    C.done()


main()
