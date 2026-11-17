"""
Shared helpers for PIP's headless Blender asset scripts.

Conventions (every asset follows them so the game can load them without per-asset fixes):
  * 1 Blender unit = 1 game world unit. Pip stands 0.9 tall.
  * Blender is Z-up; the glTF exporter converts to the game's Y-up.
  * An asset's origin sits at its base (feet / ground contact), centred.
  * Object names are snake_case and become glTF node names the game looks up.
  * Materials are Principled BSDF driven only by image textures after baking, so they export
    faithfully to glTF. Procedural shader nodes are only used on high-poly bake sources.

Run any script with:  Blender -b -P scripts/blender/<script>.py
"""
import math
import os
import sys

import bpy
import bmesh
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
BLEND_DIR = os.path.join(ROOT, "assets", "blender")
EXPORT_DIR = os.path.join(ROOT, "assets", "exports")
TEX_DIR = os.path.join(ROOT, "assets", "source-textures")


def log(*a):
    print("[pip-assets]", *a, flush=True)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    return scene


def select_only(*objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def apply_modifiers(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def shade_smooth(obj, angle_deg=40):
    select_only(obj)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))


def uv_unwrap(obj, margin=0.01, angle=66):
    select_only(obj)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=1.0)
    bpy.ops.object.mode_set(mode="OBJECT")


def origin_to_base(obj):
    """Move the origin to the bottom-centre of the bounding box, and the object to the world origin."""
    me = obj.data
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    off = Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)))
    for v in me.vertices:
        v.co -= off
    obj.location = (0, 0, 0)


def tri_count(obj):
    deps = bpy.context.evaluated_depsgraph_get()
    m = obj.evaluated_get(deps).to_mesh()
    n = sum(len(p.vertices) - 2 for p in m.polygons)
    obj.evaluated_get(deps).to_mesh_clear()
    return n


# ---------------------------------------------------------------- materials


def node(nt, kind, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        setattr(n, k, v)
    return n


def principled(name, base=(0.8, 0.8, 0.8), rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    return m


def new_image(name, size, non_color=False):
    img = bpy.data.images.new(name, width=size, height=size, alpha=False, float_buffer=False)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def baked_material(name, color_img, rough_img, normal_img, metal=0.0, emissive=None):
    """A glTF-friendly material driven by baked textures."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Metallic"].default_value = metal
    tc = node(nt, "ShaderNodeTexImage", (-500, 300), image=color_img)
    nt.links.new(tc.outputs["Color"], bsdf.inputs["Base Color"])
    tr = node(nt, "ShaderNodeTexImage", (-500, 0), image=rough_img)
    nt.links.new(tr.outputs["Color"], bsdf.inputs["Roughness"])
    tn = node(nt, "ShaderNodeTexImage", (-700, -300), image=normal_img)
    nm = node(nt, "ShaderNodeNormalMap", (-300, -300))
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if emissive:
        bsdf.inputs["Emission Color"].default_value = (*emissive[0], 1)
        bsdf.inputs["Emission Strength"].default_value = emissive[1]
    return m


def _bake_target(low, img):
    """Every material slot on `low` gets an active image node pointing at `img` (Cycles bakes into it)."""
    for slot in low.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get("__bake__") or nt.nodes.new("ShaderNodeTexImage")
        n.name = "__bake__"
        n.image = img
        nt.nodes.active = n


def bake_maps(low, high, size=1024, name="asset", extrusion=0.06, color=True, rough=True, normal=True):
    """
    Bake high-poly detail (or the low-poly's own procedural material when `high` is None) onto `low`.
    Returns (color, roughness, normal) images, saved as PNGs under assets/source-textures/baked/.
    """
    scene = bpy.context.scene
    scene.render.bake.margin = 8
    out = {}
    if not low.material_slots:
        low.data.materials.append(principled(f"{name}_bake_tmp"))
    jobs = []
    if color:
        jobs.append(("color", "DIFFUSE", False))
    if rough:
        jobs.append(("roughness", "ROUGHNESS", True))
    if normal:
        jobs.append(("normal", "NORMAL", True))
    for key, kind, nc in jobs:
        img = new_image(f"{name}_{key}", size, non_color=nc)
        if key == "normal":
            img.generated_color = (0.5, 0.5, 1.0, 1.0)
        _bake_target(low, img)
        if high:
            high.hide_render = False
            select_only(low, high)
            high.select_set(True)
            low.select_set(True)
            bpy.context.view_layer.objects.active = low
            scene.render.bake.use_selected_to_active = True
            scene.render.bake.cage_extrusion = extrusion
        else:
            select_only(low)
            scene.render.bake.use_selected_to_active = False
        kw = {"type": kind, "margin": 8}
        if kind == "DIFFUSE":
            kw["pass_filter"] = {"COLOR"}
        if kind == "NORMAL":
            kw["normal_space"] = "TANGENT"
        bpy.ops.object.bake(**kw)
        d = os.path.join(TEX_DIR, "baked")
        os.makedirs(d, exist_ok=True)
        img.filepath_raw = os.path.join(d, f"{name}_{key}.png")
        img.file_format = "PNG"
        img.save()
        out[key] = img
        log(f"baked {name}_{key} {size}px")
    return out.get("color"), out.get("roughness"), out.get("normal")


# ---------------------------------------------------------------- noise helpers for high-poly sources


def displace(obj, strength=0.3, scale=1.2, kind="CLOUDS", depth=2, name="disp"):
    tex = bpy.data.textures.new(name, type=kind)
    if kind == "CLOUDS":
        tex.noise_scale = scale
        tex.noise_depth = depth
    elif kind == "VORONOI":
        tex.noise_scale = scale
    m = obj.modifiers.new(name, "DISPLACE")
    m.texture = tex
    m.strength = strength
    m.texture_coords = "OBJECT"
    return m


# ---------------------------------------------------------------- output


def save_blend(rel_path):
    p = os.path.join(BLEND_DIR, rel_path)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    # Keep baked images alongside the .blend so the source opens self-contained.
    for img in bpy.data.images:
        if img.has_data and img.filepath_raw:
            img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=p, compress=True)
    log("saved", os.path.relpath(p, ROOT))


def export_glb(name, objects, animations=False):
    os.makedirs(EXPORT_DIR, exist_ok=True)
    p = os.path.join(EXPORT_DIR, f"{name}.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
        for c in o.children_recursive:
            c.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=p,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_animations=animations,
        export_image_format="AUTO",
        export_materials="EXPORT",
        export_extras=True,
    )
    log("exported", os.path.relpath(p, ROOT), f"{os.path.getsize(p) / 1024:.0f} KB")
    return p


def done():
    log("OK")
    sys.stdout.flush()


# ---------------------------------------------------------------- scanned (Poly Haven) source materials

PH_DIR = os.path.join(TEX_DIR, "polyhaven")


def ph_image(asset, kind, non_color):
    p = os.path.join(PH_DIR, asset, f"{kind}.jpg")
    if not os.path.exists(p):
        raise FileNotFoundError(f"{p} missing: run python3 scripts/fetch_polyhaven.py")
    img = bpy.data.images.load(p, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def ph_layer(nt, asset, scale, loc_y=0, blend=0.25):
    """Box-projected (triplanar) colour, roughness and height from a scanned material."""
    tc = node(nt, "ShaderNodeTexCoord", (-1600, loc_y))
    mp = node(nt, "ShaderNodeMapping", (-1400, loc_y))
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    out = {}
    for kind, nc, dy in [("diff", False, 0), ("rough", True, -280), ("disp", True, -560)]:
        t = node(nt, "ShaderNodeTexImage", (-1150, loc_y + dy), image=ph_image(asset, kind, nc))
        t.projection = "BOX"
        t.projection_blend = blend
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        out[kind] = t.outputs["Color"]
    return out


def ph_shader(name, base_asset, scale=1.0, tint=(1, 1, 1), top_asset=None, top_scale=1.0, top_from=0.55, top_to=0.85, bump=0.6, bump_dist=0.03):
    """
    High-poly source shader: a scanned base material, optionally blended with a second scanned material
    on up-facing surfaces (moss or grass on top of rock). Only used as a bake source.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    a = ph_layer(nt, base_asset, scale, 400)
    tintn = node(nt, "ShaderNodeMix", (-700, 400))
    tintn.data_type = "RGBA"
    tintn.blend_type = "MULTIPLY"
    tintn.inputs["Factor"].default_value = 1.0
    tintn.inputs["B"].default_value = (*tint, 1)
    nt.links.new(a["diff"], tintn.inputs["A"])
    color, rough, height = tintn.outputs["Result"], a["rough"], a["disp"]
    if top_asset:
        b = ph_layer(nt, top_asset, top_scale, -900)
        geo = node(nt, "ShaderNodeNewGeometry", (-1000, -1500))
        sep = node(nt, "ShaderNodeSeparateXYZ", (-800, -1500))
        nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
        up = node(nt, "ShaderNodeMapRange", (-600, -1500))
        up.inputs["From Min"].default_value = top_from
        up.inputs["From Max"].default_value = top_to
        nt.links.new(sep.outputs["Z"], up.inputs["Value"])
        # break the edge up with the base's height map
        brk = node(nt, "ShaderNodeMath", (-400, -1500))
        brk.operation = "MULTIPLY_ADD"
        brk.inputs[2].default_value = -0.15
        nt.links.new(up.outputs["Result"], brk.inputs[0])
        brk.inputs[1].default_value = 1.3
        mask = node(nt, "ShaderNodeClamp", (-250, -1500))
        nt.links.new(brk.outputs["Value"], mask.inputs["Value"])
        mc = node(nt, "ShaderNodeMix", (-450, 300))
        mc.data_type = "RGBA"
        nt.links.new(mask.outputs["Result"], mc.inputs["Factor"])
        nt.links.new(color, mc.inputs["A"])
        nt.links.new(b["diff"], mc.inputs["B"])
        mr = node(nt, "ShaderNodeMix", (-450, 0))
        mr.data_type = "FLOAT"
        nt.links.new(mask.outputs["Result"], mr.inputs["Factor"])
        nt.links.new(rough, mr.inputs["A"])
        nt.links.new(b["rough"], mr.inputs["B"])
        mh = node(nt, "ShaderNodeMix", (-450, -300))
        mh.data_type = "FLOAT"
        nt.links.new(mask.outputs["Result"], mh.inputs["Factor"])
        nt.links.new(height, mh.inputs["A"])
        nt.links.new(b["disp"], mh.inputs["B"])
        color, rough, height = mc.outputs["Result"], mr.outputs["Result"], mh.outputs["Result"]
    nt.links.new(color, bsdf.inputs["Base Color"])
    nt.links.new(rough, bsdf.inputs["Roughness"])
    bp = node(nt, "ShaderNodeBump", (-200, -400))
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = bump_dist
    nt.links.new(height, bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return m
