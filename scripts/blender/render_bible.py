"""
Reference renders for the art bible (docs/ART_BIBLE.md), from the exported game assets: one front orthographic
view per subject on a transparent background, in the look of a generation.

  Blender -b -P scripts/blender/render_bible.py
  → docs/art/renders/<subject>_<style>.png  (composited into sheets by scripts/art-bible-sheets.mjs)

Styles: 'early' (faceted model, flat light) · 'stylized' (three toon bands, ink lines) · 'hd' (lit, soft shadow) ·
'beyond' (low warm sun, cool fill, bloom).
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import common as C  # noqa: E402

OUT = os.path.join(C.ROOT, "docs", "art", "renders")
GLB = os.path.join(C.ROOT, "public", "assets")
# subject → (glb, node, styles)
SUBJECTS = {
    "meadow_tree": ("tree", "meadow_tree", ["hd", "beyond"]),
    "meadow_tree_shell": ("tree", "meadow_tree_shell", ["stylized"]),
    "meadow_tree_low": ("tree", "meadow_tree_low", ["early"]),
    "great_tree": ("tree", "great_tree", ["hd"]),
    "rock": ("rocks", "rock_a", ["hd"]),
    "arch": ("gateway", "shard_arch", ["hd"]),
    "pedestal": ("gateway", "block_plinth", ["hd"]),
    "pip": ("pip", "pip_rig", ["hd"]),
}
LIGHT = {
    # sun colour, strength, elevation, world colour, world strength
    "early": ("#fff1c8", 3.0, 50, "#b9c9d8", 0.9),
    "stylized": ("#fff3d6", 3.5, 45, "#d6e4c8", 0.8),
    "hd": ("#ffe2b8", 5.5, 38, "#b9c6d6", 1.1),
    # Beyond: a low warm key over a cool sky fill (shadows lean cobalt, never brown)
    "beyond": ("#ffc27a", 6.5, 22, "#9fb4d0", 1.0),
}


def import_subject(glb, node_name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(GLB, f"{glb}.glb"))
    new = [o for o in bpy.data.objects if o not in before]
    root = next(o for o in new if o.name.startswith(node_name))
    keep = {root, *root.children_recursive}
    for o in new:
        if o not in keep:
            bpy.data.objects.remove(o)
    return root, [o for o in keep if o.type == "MESH"]


def bounds(meshes):
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def toon(meshes):
    """Stylized: the base colour in three flat bands (shadow leaning cobalt), lit by the sun."""
    for o in meshes:
        for slot in o.material_slots:
            m = slot.material
            nt = m.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            base = bsdf.inputs["Base Color"].default_value[:]
            diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
            diff.inputs["Color"].default_value = (1, 1, 1, 1)
            s2r = nt.nodes.new("ShaderNodeShaderToRGB")
            nt.links.new(diff.outputs["BSDF"], s2r.inputs["Shader"])
            ramp = nt.nodes.new("ShaderNodeValToRGB")
            ramp.color_ramp.interpolation = "CONSTANT"
            els = ramp.color_ramp.elements
            shade = [base[i] * (0.42 + 0.2 * (i == 2)) for i in range(3)]
            # lit diffuse here runs about 0.5 (away from the sun) to 2 (facing it): bands at 0.75 and 1.35
            els[0].position, els[0].color = 0.0, (*shade, 1)
            els[1].position, els[1].color = 0.675, (*[c * 1.12 for c in base[:3]], 1)
            mid = els.new(0.375)
            mid.color = (*[c * 0.78 for c in base[:3]], 1)
            sep = nt.nodes.new("ShaderNodeRGBToBW")
            nt.links.new(s2r.outputs["Color"], sep.inputs["Color"])
            half = nt.nodes.new("ShaderNodeMath")
            half.operation = "MULTIPLY"
            half.inputs[1].default_value = 0.5
            nt.links.new(sep.outputs["Val"], half.inputs[0])
            nt.links.new(half.outputs[0], ramp.inputs["Fac"])
            em = nt.nodes.new("ShaderNodeEmission")
            nt.links.new(ramp.outputs["Color"], em.inputs["Color"])
            out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
            nt.links.new(em.outputs["Emission"], out.inputs["Surface"])


def flat(meshes):
    """Early 3D: faceted (flat) shading, no smoothing."""
    for o in meshes:
        for p in o.data.polygons:
            p.use_smooth = False


def render(subject, glb, node_name, style):
    C.reset_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.resolution_x = 600
    scene.render.resolution_y = 720
    scene.view_settings.view_transform = "AgX" if style in ("hd", "beyond") else "Standard"
    if style in ("hd", "beyond"):
        scene.view_settings.look = "AgX - Punchy"
    root, meshes = import_subject(glb, node_name)
    C.wire_vertex_shade(meshes)
    # Pip's face is a live canvas in the game; here, the dark screen with its two cyan eyes is enough
    for o in meshes:
        for slot in o.material_slots:
            if slot.material and slot.material.name.startswith("pip_face"):
                bsdf = next(n for n in slot.material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
                for l in list(slot.material.node_tree.links):
                    if l.to_socket == bsdf.inputs["Base Color"]:
                        slot.material.node_tree.links.remove(l)
                bsdf.inputs["Base Color"].default_value = C._lin("#1c2233")
                bsdf.inputs["Roughness"].default_value = 0.2
    if style == "stylized":
        toon(meshes)
        scene.render.use_freestyle = True
        scene.render.line_thickness = 2.2
        ls = scene.view_layers[0].freestyle_settings.linesets.new("ink")
        ls.select_by_visibility = True
        ls.linestyle.color = C._lin("#2a2230")[:3]
    if style == "early":
        flat(meshes)
    if style == "beyond" and hasattr(scene.eevee, "use_bloom"):
        scene.eevee.use_bloom = True
    lo, hi = bounds(meshes)
    size, centre = hi - lo, (lo + hi) / 2
    # camera: orthographic, from the front (-Y in Blender is the game's +z, toward the 2D camera)
    cam_d = bpy.data.cameras.new("cam")
    cam_d.type = "ORTHO"
    cam_d.ortho_scale = max(size.z * 1.12, size.x * 1.12 * 720 / 600)
    cam = bpy.data.objects.new("cam", cam_d)
    scene.collection.objects.link(cam)
    cam.location = (centre.x, centre.y - 40, centre.z)
    cam.rotation_euler = (math.radians(90), 0, 0)
    scene.camera = cam
    col, strength, elev, world, wstr = LIGHT[style]
    sun_d = bpy.data.lights.new("sun", "SUN")
    sun_d.energy = strength
    sun_d.color = C._lin(col)[:3]
    sun_d.angle = math.radians(6)
    sun = bpy.data.objects.new("sun", sun_d)
    scene.collection.objects.link(sun)
    # from the west, behind the camera's left (the bible's one sun)
    sun.rotation_euler = (math.radians(90 - elev), 0, math.radians(-35))
    w = bpy.data.worlds.new("w")
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = C._lin(world)
    bg.inputs["Strength"].default_value = wstr
    os.makedirs(OUT, exist_ok=True)
    scene.render.filepath = os.path.join(OUT, f"{subject}_{style}.png")
    bpy.ops.render.render(write_still=True)
    C.log(f"rendered {subject}_{style}")


def main():
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for subject, (glb, node_name, styles) in SUBJECTS.items():
        if only and subject not in only:
            continue
        for style in styles:
            render(subject, glb, node_name, style)
    C.done()


main()
