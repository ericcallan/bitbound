"""
The ground materials, painted rather than scanned (docs/ART_BIBLE.md): each surface of PAINTED in common.py baked
from a plane into a seamless tile, in the layout the runtime packers expect from a source material:

  assets/source-textures/painted/<set>/diff.png     colour
  assets/source-textures/painted/<set>/rough.png    roughness
  assets/source-textures/painted/<set>/disp.png     height
  assets/source-textures/painted/<set>/nor_gl.png   tangent-space normal (OpenGL, +Y)

  Blender -b -P scripts/blender/create_painted_textures.py [-- grass path ...]
"""
import os
import shutil
import sys

import bpy

sys.path.insert(0, os.path.dirname(__file__))
import common as C  # noqa: E402

OUT = os.path.join(C.TEX_DIR, "painted")
SIZE = 1024
# runtime set name → (painted kind, how many features per tile, bump)
SETS = {
    "grass": ("grass", 4.0, 0.7),
    "path": ("path", 4.0, 0.8),
    "forest": ("forest", 4.0, 0.7),
    "rock": ("rock", 3.0, 0.9),
    "stone": ("stone", 2.0, 0.9),
    "moss": ("moss", 4.0, 0.6),
    "bark": ("bark", 3.0, 1.0),
}


def save(img, path):
    """Images from C.bake_maps are already saved (under baked/): copy the file. Others are saved here."""
    if img.filepath_raw and os.path.exists(img.filepath_raw):
        shutil.copy(img.filepath_raw, path)
        return
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()


def bake_set(name, kind, scale, bump):
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 0, 0))
    plane = bpy.context.active_object
    plane.name = f"tile_{name}"
    mat = C.painted_shader(f"{name}_painted", kind, scale=scale, mode="torus", bump=bump, bump_dist=0.015, edges=False)
    plane.data.materials.append(mat)
    d = os.path.join(OUT, name)
    os.makedirs(d, exist_ok=True)
    col, rough, nrm = C.bake_maps(plane, None, size=SIZE, name=f"painted_{name}")
    save(col, os.path.join(d, "diff.png"))
    save(rough, os.path.join(d, "rough.png"))
    save(nrm, os.path.join(d, "nor_gl.png"))
    # height: route the height value through an emission shader and bake it
    nt = mat.node_tree
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    em = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(nt.nodes["__height__"].outputs[0], em.inputs["Color"])
    nt.links.new(em.outputs["Emission"], out.inputs["Surface"])
    h = C.new_image(f"painted_{name}_height", SIZE, non_color=True)
    C._bake_target(plane, h)
    C.select_only(plane)
    bpy.context.scene.render.bake.use_selected_to_active = False
    bpy.ops.object.bake(type="EMIT", margin=0)
    save(h, os.path.join(d, "disp.png"))
    C.log(f"painted {name}: {SIZE}px")
    bpy.data.objects.remove(plane)


def main():
    C.reset_scene()
    bpy.context.scene.cycles.samples = 4
    only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for name, (kind, scale, bump) in SETS.items():
        if not only or name in only:
            bake_set(name, kind, scale, bump)
    C.done()


main()
