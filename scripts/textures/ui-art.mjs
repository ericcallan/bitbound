// Trim and compress the interface stills rendered by scripts/blender/render_ui_art.py.
import sharp from 'sharp';
await sharp('assets/previews/ui/pip_hd.png').trim().resize({ height: 300 }).webp({ quality: 88, alphaQuality: 90 }).toFile('public/ui/pip_hd.webp');
console.log('public/ui/pip_hd.webp');
