import bpy, math, sys
from mathutils import Vector
argv = sys.argv[sys.argv.index("--")+1:]
act, frame, az, out = argv[0], int(argv[1]), math.radians(float(argv[2])), argv[3]
sc = bpy.context.scene
arm = bpy.data.objects["pip_rig"]
arm.animation_data.action = bpy.data.actions[act]
sc.frame_set(frame)
sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x, sc.render.resolution_y = 700, 500
w = bpy.data.worlds.new("w"); sc.world = w
w.use_nodes = True; w.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
bpy.ops.object.light_add(type="SUN", rotation=(0.8, 0.2, 0.6))
cam = bpy.data.objects.new("c", bpy.data.cameras.new("c")); sc.collection.objects.link(cam)
d = 2.6
cam.location = Vector((math.sin(az)*d, -math.cos(az)*d, 0.5 + 0.6))
cam.rotation_euler = (Vector((0,0,0.5)) - cam.location).to_track_quat("-Z","Y").to_euler()
sc.camera = cam
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
