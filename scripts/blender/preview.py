"""
Render a quick look-dev preview of an exported GLB (Eevee, sun + sky) to assets/previews/<name>.png.
Blender -b -P scripts/blender/preview.py -- <name> [camera_distance] [target_height]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else ["rocks"]
name = argv[0]
dist = float(argv[1]) if len(argv) > 1 else 4.0
th = float(argv[2]) if len(argv) > 2 else 0.4
anim = argv[3] if len(argv) > 3 else None
frame = int(argv[4]) if len(argv) > 4 else 1

C.reset_scene()
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 960
scene.render.resolution_y = 600
bpy.ops.import_scene.gltf(filepath=os.path.join(C.EXPORT_DIR, f"{name}.glb"))
roots = [o for o in scene.objects if o.parent is None]
# spread multiple roots out in a row
if len(roots) > 1 and all(o.type == "MESH" for o in roots):
    x = -(len(roots) - 1) * 1.1
    for o in roots:
        o.location.x = x
        x += 2.2
if anim:
    for o in scene.objects:
        if o.animation_data and anim in bpy.data.actions:
            o.animation_data.action = bpy.data.actions[anim]
    scene.frame_set(frame)
w = bpy.data.worlds.new("w")
scene.world = w
w.use_nodes = True
w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.7, 0.9, 1)
w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(10), math.radians(35)))
bpy.context.active_object.data.energy = 4
bpy.context.active_object.data.color = (1, 0.92, 0.8)
bpy.ops.mesh.primitive_plane_add(size=40)
g = bpy.context.active_object
g.data.materials.append(C.principled("ground", (0.25, 0.32, 0.18), 0.9))
cam = bpy.data.cameras.new("cam")
cam.lens = 50
co = bpy.data.objects.new("cam", cam)
scene.collection.objects.link(co)
co.location = Vector((dist * 0.7, -dist, th + dist * 0.35))
d = Vector((0, 0, th)) - co.location
co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
scene.camera = co
out = os.path.join(C.ROOT, "assets", "previews", f"{name}{'_' + anim if anim else ''}.png")
os.makedirs(os.path.dirname(out), exist_ok=True)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
C.log("preview", os.path.relpath(out, C.ROOT))
