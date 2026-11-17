"""
Prepare a Poly Haven sky (CC0) for the game:
  * public/assets/sky/<name>_env.hdr  512x256 Radiance HDR for image-based lighting (PMREM)
  * public/assets/sky/<name>_sky.jpg  2048x1024 tone-mapped panorama for the visible sky
  * public/assets/sky/<name>.json     the sun direction (brightest point), so the game's key light and
                                      shadows match the sky

Blender -b -P scripts/blender/create_sky.py -- kloofendal_48d_partly_cloudy_puresky day
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
import bpy  # noqa: E402
import common as C  # noqa: E402

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else ["kloofendal_48d_partly_cloudy_puresky", "day"]
src_name, out_name = argv[0], argv[1]
OUT = os.path.join(C.ROOT, "public", "assets", "sky")
os.makedirs(OUT, exist_ok=True)

src = bpy.data.images.load(os.path.join(C.PH_DIR, f"{src_name}_2k.hdr"))
w, h = src.size
px = list(src.pixels)

# brightest pixel → sun direction (equirect: u = azimuth, v = elevation)
best, bi = -1.0, 0
for i in range(0, len(px), 4):
    lum = px[i] * 0.2126 + px[i + 1] * 0.7152 + px[i + 2] * 0.0722
    if lum > best:
        best, bi = lum, i // 4
bx, by = bi % w, bi // w
u, v = (bx + 0.5) / w, (by + 0.5) / h
phi = (u - 0.5) * 2 * math.pi  # three.js equirect: u=0.5 looks down -z
theta = (v - 0.5) * math.pi  # v=1 is up (Blender pixel rows go bottom→top)
# three.js equirectangular mapping: dir = (-sin(phi)… ) — match THREE's equirectUv: u = atan(dir.z, dir.x) / 2π + 0.5
dx = math.cos(theta) * math.cos((u - 0.5) * 2 * math.pi)
dz = math.cos(theta) * math.sin((u - 0.5) * 2 * math.pi)
dy = math.sin(theta)
sun = {"dir": [dx, dy, dz], "elevationDeg": math.degrees(theta), "peak": best}
C.log(f"sun at pixel {bx},{by}  elevation {math.degrees(theta):.1f}°  peak {best:.0f}")

# small HDR for lighting
env = src.copy()
env.scale(512, 256)
env.filepath_raw = os.path.join(OUT, f"{out_name}_env.hdr")
env.file_format = "HDR"
env.save()

# tone-mapped panorama for the visible sky (AgX, slightly under-exposed so clouds keep detail)
scene = bpy.context.scene
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = -0.3
pano = src.copy()
pano.scale(2048, 1024)
pano.save_render(os.path.join(OUT, f"{out_name}_sky.jpg"), scene=scene, quality=88)
with open(os.path.join(OUT, f"{out_name}.json"), "w") as f:
    json.dump(sun, f)
for n in (f"{out_name}_env.hdr", f"{out_name}_sky.jpg"):
    C.log(n, f"{os.path.getsize(os.path.join(OUT, n)) / 1024:.0f} KB")
C.done()
