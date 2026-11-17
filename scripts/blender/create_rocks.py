"""
Mossy rocks: three variants. A dense displaced high-poly with a procedural rock-and-moss shader is
baked (colour, roughness, normal) onto a light low-poly that ships in the game.

Blender -b -P scripts/blender/create_rocks.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import common as C  # noqa: E402


def rock_shader(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tc = C.node(nt, "ShaderNodeTexCoord", (-1400, 0))
    # Rock body: layered noise mapped to warm greys.
    n1 = C.node(nt, "ShaderNodeTexNoise", (-1100, 300))
    n1.inputs["Scale"].default_value = 3.5
    n1.inputs["Detail"].default_value = 10
    n1.inputs["Roughness"].default_value = 0.62
    nt.links.new(tc.outputs["Object"], n1.inputs["Vector"])
    ramp = C.node(nt, "ShaderNodeValToRGB", (-850, 300))
    ramp.color_ramp.elements[0].color = (0.16, 0.15, 0.14, 1)
    ramp.color_ramp.elements[1].color = (0.52, 0.49, 0.44, 1)
    nt.links.new(n1.outputs["Fac"], ramp.inputs["Fac"])
    # Crevices: voronoi edges darken.
    vo = C.node(nt, "ShaderNodeTexVoronoi", (-1100, -50))
    vo.feature = "DISTANCE_TO_EDGE"
    vo.inputs["Scale"].default_value = 5.0
    nt.links.new(tc.outputs["Object"], vo.inputs["Vector"])
    crev = C.node(nt, "ShaderNodeMapRange", (-850, -50))
    crev.inputs["From Min"].default_value = 0.0
    crev.inputs["From Max"].default_value = 0.08
    crev.inputs["To Min"].default_value = 0.35
    crev.inputs["To Max"].default_value = 1.0
    nt.links.new(vo.outputs["Distance"], crev.inputs["Value"])
    rockc = C.node(nt, "ShaderNodeMix", (-600, 200))
    rockc.data_type = "RGBA"
    rockc.blend_type = "MULTIPLY"
    rockc.inputs["Factor"].default_value = 1.0
    nt.links.new(ramp.outputs["Color"], rockc.inputs["A"])
    nt.links.new(crev.outputs["Result"], rockc.inputs["B"])
    # Moss on up-facing surfaces, broken up by noise.
    geo = C.node(nt, "ShaderNodeNewGeometry", (-1400, -400))
    sep = C.node(nt, "ShaderNodeSeparateXYZ", (-1200, -400))
    nt.links.new(geo.outputs["Normal"], sep.inputs["Vector"])
    up = C.node(nt, "ShaderNodeMapRange", (-1000, -400))
    up.inputs["From Min"].default_value = 0.45
    up.inputs["From Max"].default_value = 0.85
    nt.links.new(sep.outputs["Z"], up.inputs["Value"])
    n2 = C.node(nt, "ShaderNodeTexNoise", (-1000, -650))
    n2.inputs["Scale"].default_value = 6.0
    n2.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], n2.inputs["Vector"])
    mossmask = C.node(nt, "ShaderNodeMath", (-800, -500))
    mossmask.operation = "MULTIPLY"
    nt.links.new(up.outputs["Result"], mossmask.inputs[0])
    nt.links.new(n2.outputs["Fac"], mossmask.inputs[1])
    mossk = C.node(nt, "ShaderNodeMapRange", (-600, -500))
    mossk.inputs["From Min"].default_value = 0.22
    mossk.inputs["From Max"].default_value = 0.42
    nt.links.new(mossmask.outputs["Value"], mossk.inputs["Value"])
    mossc = C.node(nt, "ShaderNodeValToRGB", (-600, -250))
    mossc.color_ramp.elements[0].color = (0.07, 0.14, 0.03, 1)
    mossc.color_ramp.elements[1].color = (0.30, 0.42, 0.10, 1)
    nt.links.new(n2.outputs["Fac"], mossc.inputs["Fac"])
    col = C.node(nt, "ShaderNodeMix", (-350, 100))
    col.data_type = "RGBA"
    nt.links.new(mossk.outputs["Result"], col.inputs["Factor"])
    nt.links.new(rockc.outputs["Result"], col.inputs["A"])
    nt.links.new(mossc.outputs["Color"], col.inputs["B"])
    nt.links.new(col.outputs["Result"], bsdf.inputs["Base Color"])
    rough = C.node(nt, "ShaderNodeMapRange", (-350, -150))
    rough.inputs["To Min"].default_value = 0.68
    rough.inputs["To Max"].default_value = 0.95
    nt.links.new(mossk.outputs["Result"], rough.inputs["Value"])
    nt.links.new(rough.outputs["Result"], bsdf.inputs["Roughness"])
    bump = C.node(nt, "ShaderNodeBump", (-350, -400))
    bump.inputs["Strength"].default_value = 0.45
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(n1.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return m


VARIANTS = [
    ("rock_a", (1.4, 1.0, 0.72), 11),
    ("rock_b", (1.0, 0.9, 0.95), 23),
    ("rock_c", (1.8, 1.1, 0.55), 37),
]


def make_rock(name, scale, seed):
    def base(subdiv):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=0.5)
        o = bpy.context.active_object
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        for i, (kind, strength, sc) in enumerate([("CLOUDS", 0.22, 0.9), ("VORONOI", 0.08, 0.5)]):
            m = C.displace(o, strength=strength, scale=sc, kind=kind, name=f"{name}_d{i}")
            m.texture_coords = "LOCAL"
            m.direction = "NORMAL"

        # flatten the base so it sits on the ground
        return o

    high = base(6)
    high.name = f"{name}_high"
    for m in high.modifiers:
        m.strength *= 1.0
    C.apply_modifiers(high)
    low = base(4)
    low.name = name
    C.apply_modifiers(low)
    # Seed variation: offset vertices along a pseudo-random warp shared by both meshes.
    import random

    random.seed(seed)
    ox, oy = random.uniform(-0.2, 0.2), random.uniform(-0.2, 0.2)
    for o in (high, low):
        for v in o.data.vertices:
            v.co.x += ox * v.co.z
            v.co.y += oy * v.co.z
            if v.co.z < -0.12 * scale[2] * 2:
                v.co.z = -0.12 * scale[2] * 2  # flat-ish underside, buried in the ground
    dec = low.modifiers.new("dec", "DECIMATE")
    dec.ratio = 0.6
    C.apply_modifiers(low)
    C.shade_smooth(high, 60)
    C.shade_smooth(low, 50)
    for o in (high, low):
        C.origin_to_base(o)
    high.data.materials.append(C.ph_shader(f"{name}_src", "rock_face_03", scale=0.9, tint=(1.02, 0.98, 0.92), top_asset="mossy_rock", top_scale=1.1, top_from=0.35, top_to=0.75, bump=0.8))
    C.uv_unwrap(low, margin=0.02)
    low.data.materials.append(C.principled(f"{name}_tmp"))
    col, rough, nrm = C.bake_maps(low, high, size=1024, name=name, extrusion=0.08)
    low.data.materials.clear()
    low.data.materials.append(C.baked_material(f"{name}_mat", col, rough, nrm))
    high.hide_render = True
    high.hide_set(True)
    C.log(f"{name}: low {C.tri_count(low)} tris (high {C.tri_count(high)})")
    return low, high


def main():
    C.reset_scene()
    lows = []
    for i, (name, scale, seed) in enumerate(VARIANTS):
        low, high = make_rock(name, scale, seed)
        lows.append(low)
    # lay them out in the .blend for viewing; the GLB keeps each at its own origin
    C.save_blend("props/rocks.blend")
    C.export_glb("rocks", lows)
    C.done()


main()
