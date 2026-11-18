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


# ---------------------------------------------------------------- painted (procedural) source materials
#
# The art bible's surfaces (docs/ART_BIBLE.md): broad regions of a few palette colours, mid-scale value variation,
# short brush-like strokes, flecks, and on modelled objects worn edges and crevices. No photographs. Every texture
# is 4D noise: on objects the fourth dimension is a constant, and for tileable ground textures UV is wrapped onto
# two circles (u → x,y; v → z,w), so a bake on a plane tiles without seams.

def _lin(h):
    """sRGB hex → linear RGBA (Blender colour ramps and defaults are linear)."""
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c(int(h[1:3], 16)), c(int(h[3:5], 16)), c(int(h[5:7], 16)), 1.0)


PAINTED = {
    # ramp: broad regions dark → light · stroke: the colour short strokes lean to · fleck: small spots
    "grass": dict(ramp=[(0.0, "#3e5b3a"), (0.42, "#567a42"), (0.78, "#7f9c55"), (1.0, "#9db466")], stroke="#a9bf6e", stretch=(1, 3.2),
                  fleck="#c3cf8e", fleck_amt=0.22, fleck_size=0.22, fleck_freq=9.0, blades="#2f4a2e", rough=0.9, freq=1.0),
    "path": dict(ramp=[(0.0, "#8f6a45"), (0.5, "#b98a5a"), (1.0, "#cfa774")], stroke="#d6b383", stretch=(1, 2.2),
                 fleck="#e4d6b6", fleck_amt=0.3, fleck_size=0.28, fleck_freq=7.0, pebbles=True, rough=0.92, freq=1.0),
    "forest": dict(ramp=[(0.0, "#3a432c"), (0.45, "#5a4a32"), (1.0, "#7a6a3e")], stroke="#6e7f45", stretch=(1, 1.6),
                   fleck="#d58f3c", fleck_amt=0.32, fleck_size=0.34, fleck_freq=6.0, rough=0.92, freq=1.1),
    "rock": dict(ramp=[(0.0, "#857f7a"), (0.38, "#a8957a"), (0.75, "#c4b292"), (1.0, "#d9c7a3")], stroke="#e2d3b2", stretch=(1, 1.6),
                 crack="#545468", crack_freq=2.6, rough=0.84, freq=0.8),
    "stone": dict(ramp=[(0.0, "#c2ae8a"), (0.5, "#dccdae"), (1.0, "#f1e6cf")], stroke="#f6eedb", stretch=(1.4, 1),
                  mortar="#8a8670", bricks=True, rough=0.8, freq=0.8),
    "moss": dict(ramp=[(0.0, "#2f4a2e"), (0.45, "#4e7040"), (0.85, "#7f9c55"), (1.0, "#9fb468")], stroke="#a8bd6c", stretch=(1, 1),
                 fleck="#b9c97c", fleck_amt=0.25, fleck_size=0.3, fleck_freq=8.0, blades="#2f4a2e", rough=0.96, freq=1.3),
    "bark": dict(ramp=[(0.0, "#36261d"), (0.5, "#5a3d2b"), (1.0, "#7d5a3c")], stroke="#8c6a48", stretch=(1, 7.0),
                 furrows=True, rough=0.86, freq=1.4),
}


def _math(nt, op, a, b=None, loc=(0, 0), clamp=False):
    n = node(nt, "ShaderNodeMath", loc)
    n.operation = op
    n.use_clamp = clamp
    for i, v in enumerate((a, b)):
        if v is None:
            continue
        if isinstance(v, (int, float)):
            n.inputs[i].default_value = v
        else:
            nt.links.new(v, n.inputs[i])
    return n.outputs[0]


def _maprange(nt, v, f0, f1, t0=0.0, t1=1.0, smooth=True):
    n = node(nt, "ShaderNodeMapRange")
    n.interpolation_type = "SMOOTHSTEP" if smooth else "LINEAR"
    n.inputs["From Min"].default_value = f0
    n.inputs["From Max"].default_value = f1
    n.inputs["To Min"].default_value = t0
    n.inputs["To Max"].default_value = t1
    nt.links.new(v, n.inputs["Value"])
    return n.outputs["Result"]


def _mix(nt, fac, a, b, blend="MIX"):
    """Colour mix; `a`/`b` may be sockets or hex colours; `fac` a socket or a float."""
    n = node(nt, "ShaderNodeMix")
    n.data_type = "RGBA"
    n.blend_type = blend
    for key, v in (("A", a), ("B", b)):
        if isinstance(v, str):
            n.inputs[key].default_value = _lin(v)
        elif isinstance(v, tuple):
            n.inputs[key].default_value = v
        else:
            nt.links.new(v, n.inputs[key])
    if isinstance(fac, (int, float)):
        n.inputs["Factor"].default_value = fac
    else:
        nt.links.new(fac, n.inputs["Factor"])
    return n.outputs["Result"]


class _Space:
    """Texture coordinates: 'object' (3D object space) or 'torus' (UV wrapped for seamless tiles)."""

    def __init__(self, nt, mode, scale):
        self.nt, self.mode, self.scale = nt, mode, scale
        tc = node(nt, "ShaderNodeTexCoord", (-2400, 0))
        if mode == "torus":
            sep = node(nt, "ShaderNodeSeparateXYZ", (-2200, 0))
            nt.links.new(tc.outputs["UV"], sep.inputs["Vector"])
            self.a = _math(nt, "MULTIPLY", sep.outputs["X"], 2 * math.pi)
            self.b = _math(nt, "MULTIPLY", sep.outputs["Y"], 2 * math.pi)
            self.parts = {k: _math(nt, op, s) for k, (op, s) in {"ca": ("COSINE", self.a), "sa": ("SINE", self.a), "cb": ("COSINE", self.b), "sb": ("SINE", self.b)}.items()}
        else:
            self.obj = tc.outputs["Object"]

    def coords(self, freq, stretch=(1, 1), seed=0.0):
        """(vector, w) for features about 1/`freq` in size; `stretch` lengthens features along (x, y)."""
        nt = self.nt
        f = freq * self.scale
        if self.mode == "torus":
            # a feature every 1/f of the tile: circles of circumference f (radius f / 2π), stretched per axis
            ru = f / stretch[0] / (2 * math.pi)
            rv = f / stretch[1] / (2 * math.pi)
            x = _math(nt, "MULTIPLY_ADD", self.parts["ca"], ru)
            x.node.inputs[2].default_value = seed * 3.7  # the seed shifts along x (still periodic)
            y = _math(nt, "MULTIPLY", self.parts["sa"], ru)
            z = _math(nt, "MULTIPLY", self.parts["cb"], rv)
            w = _math(nt, "MULTIPLY", self.parts["sb"], rv)
            comb = node(nt, "ShaderNodeCombineXYZ")
            nt.links.new(x, comb.inputs["X"])
            nt.links.new(y, comb.inputs["Y"])
            nt.links.new(z, comb.inputs["Z"])
            return comb.outputs["Vector"], w
        mp = node(nt, "ShaderNodeMapping")
        # object space: stretch (x, y) maps to (horizontal, vertical) for bark-like strokes running up the trunk
        mp.inputs["Scale"].default_value = (f / stretch[0], f / stretch[0], f / stretch[1])
        mp.inputs["Location"].default_value = (seed * 3.7, seed * 1.3, seed * 2.1)
        nt.links.new(self.obj, mp.inputs["Vector"])
        val = node(nt, "ShaderNodeValue")
        val.outputs[0].default_value = seed * 5.3
        return mp.outputs["Vector"], val.outputs[0]

    def noise(self, freq, detail=2.0, rough=0.5, stretch=(1, 1), seed=0.0, distortion=0.0):
        nt = self.nt
        n = node(nt, "ShaderNodeTexNoise")
        n.noise_dimensions = "4D"
        v, w = self.coords(freq, stretch, seed)
        nt.links.new(v, n.inputs["Vector"])
        nt.links.new(w, n.inputs["W"])
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Detail"].default_value = detail
        n.inputs["Roughness"].default_value = rough
        n.inputs["Distortion"].default_value = distortion
        return n.outputs["Fac"]

    def voronoi(self, freq, feature="F1", stretch=(1, 1), seed=0.0, randomness=1.0):
        nt = self.nt
        n = node(nt, "ShaderNodeTexVoronoi")
        n.voronoi_dimensions = "4D"
        n.feature = feature
        v, w = self.coords(freq, stretch, seed)
        nt.links.new(v, n.inputs["Vector"])
        nt.links.new(w, n.inputs["W"])
        n.inputs["Scale"].default_value = 1.0
        n.inputs["Randomness"].default_value = randomness
        return n.outputs


def _painted_layer(nt, sp, kind, objectish):
    """Colour, roughness and height sockets for one painted surface kind."""
    p = PAINTED[kind]
    seed = sum(ord(c) for c in kind) * 0.01
    # 1. broad regions: a few palette colours, eased (a painter's large flat areas, not noise)
    broad = sp.noise(p["freq"] * 0.7, detail=1.5, rough=0.45, seed=seed, distortion=0.3)
    ramp = node(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    els = ramp.color_ramp.elements
    stops = p["ramp"]
    els[0].position, els[0].color = stops[0][0], _lin(stops[0][1])
    els[1].position, els[1].color = stops[-1][0], _lin(stops[-1][1])
    for pos, col in stops[1:-1]:
        e = els.new(pos)
        e.color = _lin(col)
    nt.links.new(_maprange(nt, broad, 0.3, 0.7, smooth=False), ramp.inputs["Fac"])
    col = ramp.outputs["Color"]
    # 2. mid-scale value variation (±10%)
    mid = sp.noise(p["freq"] * 1.4, detail=3.0, rough=0.55, seed=seed + 1)
    val = _maprange(nt, mid, 0.3, 0.7, 0.88, 1.1, smooth=False)
    cc = node(nt, "ShaderNodeCombineColor")
    for s in ("Red", "Green", "Blue"):
        nt.links.new(val, cc.inputs[s])
    col = _mix(nt, 1.0, col, cc.outputs["Color"], "MULTIPLY")
    # 3. brush strokes: short stretched dabs leaning lighter
    strokes = sp.noise(p["freq"] * 4.0, detail=1.0, rough=0.4, stretch=p["stretch"], seed=seed + 2)
    smask = _maprange(nt, strokes, 0.56, 0.68)
    col = _mix(nt, _math(nt, "MULTIPLY", smask, 0.38), col, p["stroke"])
    height = _math(nt, "ADD", _math(nt, "MULTIPLY", broad, 0.35), _math(nt, "MULTIPLY", smask, 0.25))
    # fine blades: thin dark and light ticks (grass, moss), so the surface holds up close to Pip
    if p.get("blades"):
        fine = sp.noise(p["freq"] * 14.0, detail=1.0, rough=0.3, stretch=(1, 4.5), seed=seed + 7)
        dark = _maprange(nt, fine, 0.36, 0.28)
        light = _maprange(nt, fine, 0.64, 0.72)
        col = _mix(nt, _math(nt, "MULTIPLY", dark, 0.45), col, p["blades"])
        col = _mix(nt, _math(nt, "MULTIPLY", light, 0.3), col, p["stroke"])
        height = _math(nt, "ADD", height, _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", light, dark), 0.3))
    rough = _maprange(nt, mid, 0.3, 0.7, p["rough"] - 0.06, p["rough"] + 0.04, smooth=False)
    # 4. flecks / pebbles / leaves: small cells, a random share of them coloured
    if p.get("fleck"):
        vo = sp.voronoi(p["freq"] * p["fleck_freq"], seed=seed + 3)
        sep = node(nt, "ShaderNodeSeparateColor")
        nt.links.new(vo["Color"], sep.inputs["Color"])
        pick = _maprange(nt, sep.outputs["Red"], 1.0 - p["fleck_amt"] - 0.02, 1.0 - p["fleck_amt"] + 0.02)
        dot = _maprange(nt, vo["Distance"], p["fleck_size"], p["fleck_size"] * 0.55)
        fm = _math(nt, "MULTIPLY", pick, dot)
        col = _mix(nt, _math(nt, "MULTIPLY", fm, 0.85), col, p["fleck"])
        height = _math(nt, "ADD", height, _math(nt, "MULTIPLY", fm, 0.55 if p.get("pebbles") else 0.25))
        if p.get("pebbles"):
            rough = _math(nt, "SUBTRACT", rough, _math(nt, "MULTIPLY", fm, 0.25))
    # 5. bark furrows: long vertical grooves
    if p.get("furrows"):
        fur = sp.voronoi(p["freq"] * 2.2, "DISTANCE_TO_EDGE", stretch=(1, 9.0), seed=seed + 4)
        groove = _maprange(nt, fur["Distance"], 0.0, 0.12, 1.0, 0.0)
        col = _mix(nt, _math(nt, "MULTIPLY", groove, 0.7), col, "#24180f")
        height = _math(nt, "SUBTRACT", height, _math(nt, "MULTIPLY", groove, 0.6))
    # 6. ivory masonry: blocks with mortar (tileable in UV; on objects the geometry is already blocks)
    if p.get("bricks") and not objectish:
        tc = node(nt, "ShaderNodeTexCoord")
        br = node(nt, "ShaderNodeTexBrick")
        br.offset = 0.5
        br.offset_frequency = 2
        nt.links.new(tc.outputs["UV"], br.inputs["Vector"])
        br.inputs["Scale"].default_value = 1.0
        br.inputs["Brick Width"].default_value = 0.25
        br.inputs["Row Height"].default_value = 0.125
        br.inputs["Mortar Size"].default_value = 0.008
        br.inputs["Mortar Smooth"].default_value = 0.6
        br.inputs["Bias"].default_value = 0.0
        br.inputs["Color1"].default_value = (1, 1, 1, 1)
        br.inputs["Color2"].default_value = (0.76, 0.74, 0.7, 1)
        br.inputs["Mortar"].default_value = (0, 0, 0, 1)
        col = _mix(nt, 1.0, col, br.outputs["Color"], "MULTIPLY")
        col = _mix(nt, _math(nt, "MULTIPLY", br.outputs["Fac"], 0.85), col, p["mortar"])
        height = _math(nt, "SUBTRACT", height, _math(nt, "MULTIPLY", br.outputs["Fac"], 0.9))
    # 7. cracks: thin dark lines along cell edges (rock faces, old stone)
    if p.get("crack"):
        cr = sp.voronoi(p["freq"] * p["crack_freq"], "DISTANCE_TO_EDGE", seed=seed + 5)
        jitter = sp.noise(p["freq"] * 6.0, detail=2.0, seed=seed + 6)
        line = _maprange(nt, _math(nt, "ADD", cr["Distance"], _math(nt, "MULTIPLY", jitter, 0.04)), 0.012, 0.04, 1.0, 0.0)
        # only some edges crack: a broad mask, so faces read as stone with a few fissures, not a net
        line = _math(nt, "MULTIPLY", line, _maprange(nt, sp.noise(p["freq"] * 1.1, detail=1.0, seed=seed + 8), 0.48, 0.6))
        col = _mix(nt, _math(nt, "MULTIPLY", line, 0.75), col, p["crack"])
        height = _math(nt, "SUBTRACT", height, _math(nt, "MULTIPLY", line, 0.5))
    return col, rough, height


def painted_shader(name, kind, scale=1.0, tint=(1, 1, 1), top_kind=None, top_from=0.55, top_to=0.85, bump=0.5, bump_dist=0.03, mode="object", edges=True):
    """
    A painted bake source in the art bible's style (replaces the scanned `ph_shader`). `kind` is a key of
    PAINTED; `top_kind` blends a second painted surface on up-facing faces (moss on stone). `mode` 'torus' makes
    a tileable texture from a plane's UVs. Height is left on a node named "__height__" for bakes that need it.
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    objectish = mode == "object"
    sp = _Space(nt, mode, scale)
    col, rough, height = _painted_layer(nt, sp, kind, objectish)
    if top_kind:
        tcol, trough, theight = _painted_layer(nt, sp, top_kind, objectish)
        geo = node(nt, "ShaderNodeNewGeometry")
        sep = node(nt, "ShaderNodeSeparateXYZ")
        nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
        brk = sp.noise(2.2, detail=2.0, seed=9.0)
        up = _math(nt, "ADD", sep.outputs["Z"], _math(nt, "MULTIPLY", _math(nt, "SUBTRACT", brk, 0.5), 0.35))
        mask = _maprange(nt, up, top_from, top_to)
        col = _mix(nt, mask, col, tcol)
        rough = _math(nt, "ADD", _math(nt, "MULTIPLY", rough, _math(nt, "SUBTRACT", 1.0, mask)), _math(nt, "MULTIPLY", trough, mask))
        height = _math(nt, "ADD", height, _math(nt, "MULTIPLY", mask, 0.2))
    if objectish and edges:
        # worn, lighter edges and darker, cooler crevices: what makes it read as made by hand
        geo = node(nt, "ShaderNodeNewGeometry")
        wear = _maprange(nt, geo.outputs["Pointiness"], 0.52, 0.6)
        col = _mix(nt, _math(nt, "MULTIPLY", wear, 0.45), col, "#f6ead0")
        ao = node(nt, "ShaderNodeAmbientOcclusion")
        ao.samples = 8
        ao.inputs["Distance"].default_value = 0.35
        crev = _math(nt, "SUBTRACT", 1.0, ao.outputs["AO"])
        col = _mix(nt, _math(nt, "MULTIPLY", crev, 0.55), col, "#3d4462")
    if tuple(tint) != (1, 1, 1):
        col = _mix(nt, 1.0, col, (*tint, 1.0), "MULTIPLY")
    nt.links.new(col, bsdf.inputs["Base Color"])
    nt.links.new(rough, bsdf.inputs["Roughness"])
    hn = node(nt, "ShaderNodeMath")
    hn.name = "__height__"
    hn.operation = "ADD"
    nt.links.new(height, hn.inputs[0])
    hn.inputs[1].default_value = 0.0
    bp = node(nt, "ShaderNodeBump")
    bp.inputs["Strength"].default_value = bump
    bp.inputs["Distance"].default_value = bump_dist
    nt.links.new(hn.outputs[0], bp.inputs["Height"])
    nt.links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return m


def wire_vertex_shade(meshes):
    """The glTF importer keeps COLOR_0 as an attribute but leaves it out of the material: multiply it back in."""
    for o in meshes:
        attrs = [a.name for a in o.data.color_attributes]
        if not attrs:
            continue
        for slot in o.material_slots:
            nt = slot.material.node_tree
            bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
            link = next((l for l in nt.links if l.to_socket == bsdf.inputs["Base Color"]), None)
            if not link:
                continue
            ca = nt.nodes.new("ShaderNodeVertexColor")
            ca.layer_name = attrs[0]
            mul = nt.nodes.new("ShaderNodeMix")
            mul.data_type = "RGBA"
            mul.blend_type = "MULTIPLY"
            mul.inputs["Factor"].default_value = 1.0
            nt.links.new(link.from_socket, mul.inputs["A"])
            nt.links.new(ca.outputs["Color"], mul.inputs["B"])
            nt.links.new(mul.outputs["Result"], bsdf.inputs["Base Color"])
