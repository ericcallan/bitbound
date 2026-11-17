"""
Download the CC0 Poly Haven sources used by the Blender scripts (2K JPG maps + 2K HDRIs).
Sources are not committed; run this once after cloning:  python3 scripts/fetch_polyhaven.py
Licence: CC0 (https://polyhaven.com/license). Recorded in docs/ASSETS.md.
"""
import json
import os
import subprocess

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "assets", "source-textures", "polyhaven")
TEXTURES = [
    "mossy_rock",
    "rock_face_03",
    "forrest_ground_01",
    "leafy_grass",
    "dirt_floor",
    "bark_brown_02",
    "rough_block_wall",
    "forest_leaves_02",
]
HDRIS = ["kloofendal_48d_partly_cloudy_puresky", "kloppenheim_06_puresky"]
MAPS = [("Diffuse", "diff"), ("nor_gl", "nor_gl"), ("Rough", "rough"), ("AO", "ao"), ("Displacement", "disp")]
UA = "pip-asset-pipeline/1.0"


def curl(url, out=None):
    args = ["curl", "-sfL", "-A", UA, url] + (["-o", out] if out else [])
    return subprocess.run(args, capture_output=True, check=True).stdout


def main():
    for t in TEXTURES:
        files = json.loads(curl(f"https://api.polyhaven.com/files/{t}"))
        os.makedirs(os.path.join(OUT, t), exist_ok=True)
        for key, name in MAPS:
            out = os.path.join(OUT, t, f"{name}.jpg")
            if key in files and not os.path.exists(out):
                curl(files[key]["2k"]["jpg"]["url"], out)
        print("ok", t)
    for h in HDRIS:
        out = os.path.join(OUT, f"{h}_2k.hdr")
        if not os.path.exists(out):
            files = json.loads(curl(f"https://api.polyhaven.com/files/{h}"))
            curl(files["hdri"]["2k"]["hdr"]["url"], out)
        print("ok", h)


main()
