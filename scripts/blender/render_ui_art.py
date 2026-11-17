"""
Stills of the Blender Pip for the interface: the "Break the Frame" card on the title screen shows the 8-bit
sprite becoming this render. Perspective, three-quarter view, warm key and teal rim, transparent background.

Blender -b -P scripts/blender/render_ui_art.py   → assets/previews/ui/pip_hd.png (scripts/textures/ui-art.mjs
then writes public/ui/pip_hd.webp)
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

OUT = os.path.join(C.ROOT, "assets", "previews", "ui")
os.makedirs(OUT, exist_ok=True)


def paint_face(img):
    """The live screen-face as a still: two bright eyes on the dark display (as in render_sprites16.py)."""
    w, h = img.size
    px = [0.0] * (w * h * 4)
    for y in range(h):
        for x in range(w):
            i = (y * w + x) * 4
            u, v = x / w, y / h
            eye = any(abs(u - cx) < 0.07 and abs(v - 0.5) < 0.13 for cx in (0.36, 0.64))
            c = (0.75, 1.0, 1.0) if eye else (0.0, 0.01, 0.03)
            px[i : i + 4] = [c[0], c[1], c[2], 1.0]
    img.pixels = px


def main():
    C.reset_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.66, 0.85, 1)
    w.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    # warm key from the upper left, teal rim from behind right
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(-30), math.radians(-35)))
    bpy.context.active_object.data.energy = 4.0
    bpy.context.active_object.data.color = (1.0, 0.86, 0.68)
    bpy.ops.object.light_add(type="AREA", location=(1.2, 1.6, 1.6))
    rim = bpy.context.active_object
    rim.data.energy = 120
    rim.data.color = (0.35, 0.95, 0.9)
    rim.data.size = 1.5
    rim.rotation_euler = (math.radians(-60), 0, math.radians(150))

    bpy.ops.import_scene.gltf(filepath=os.path.join(C.EXPORT_DIR, "pip.glb"))
    pivot = bpy.data.objects.new("pivot", None)
    scene.collection.objects.link(pivot)
    for r in [o for o in scene.objects if o.parent is None and o is not pivot and o.type in {"MESH", "ARMATURE", "EMPTY"}]:
        r.parent = pivot
    pivot.rotation_euler = (0, 0, 0.55)
    act = bpy.data.actions.get("idle")
    for o in scene.objects:
        if o.type == "ARMATURE" and act:
            o.animation_data_create()
            o.animation_data.action = act
            scene.frame_set(int(act.frame_range[0]))
    for o in list(scene.objects):
        if o.type == "MESH":
            C.log("mesh", o.name)
            if o.name.startswith("Icosphere") or "shadow" in o.name.lower():
                bpy.data.objects.remove(o)
                continue
            for slot in o.material_slots:
                m = slot.material
                C.log("  material", m.name if m else None)
                if m and m.name.startswith("pip_glass"):
                    # the faceplate: dark tinted glass over the screen
                    b = m.node_tree.nodes.get("Principled BSDF")
                    if b:
                        b.inputs["Base Color"].default_value = (0.02, 0.05, 0.07, 1)
                        b.inputs["Alpha"].default_value = 0.35
                        b.inputs["Roughness"].default_value = 0.05
                if m and m.name.startswith("pip_face"):
                    # a matte-ish screen, so it doesn't mirror the bright sky and wash the eyes out
                    b = m.node_tree.nodes.get("Principled BSDF")
                    if b:
                        b.inputs["Roughness"].default_value = 0.45
                        b.inputs["Specular IOR Level"].default_value = 0.15
                    for n in m.node_tree.nodes:
                        # the glow comes from the eyes only (the export glows the whole screen evenly)
                        if n.type == "TEX_IMAGE" and b:
                            m.node_tree.links.new(n.outputs["Color"], b.inputs["Emission Color"])
                            b.inputs["Emission Strength"].default_value = 2.0
                        if n.type == "TEX_IMAGE" and n.image:
                            paint_face(n.image)
    bpy.context.view_layer.update()

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
    centre = (lo + hi) / 2
    cam = bpy.data.cameras.new("cam")
    cam.lens = 85
    co = bpy.data.objects.new("cam", cam)
    scene.collection.objects.link(co)
    # slightly below eye level, in front (game +z is Blender -y)
    co.location = centre + Vector((0.25, -5.2, -0.05))
    d = centre - co.location
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    scene.camera = co
    scene.render.resolution_x = 512
    scene.render.resolution_y = 640
    scene.render.filepath = os.path.join(OUT, "pip_hd.png")
    bpy.ops.render.render(write_still=True)
    C.log("pip_hd", (hi - lo))
    C.done()


main()
