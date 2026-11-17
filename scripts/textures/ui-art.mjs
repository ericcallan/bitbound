// Trim and compress the interface stills rendered by scripts/blender/render_ui_art.py.
import sharp from 'sharp';
await sharp('assets/previews/ui/pip_hd.png').trim().resize({ height: 300 }).webp({ quality: 88, alphaQuality: 90 }).toFile('public/ui/pip_hd.webp');
console.log('public/ui/pip_hd.webp');

// The 16-bit title screen's Pip: the same render reduced the way mid-90s pre-rendered sprites were (Donkey Kong
// Country): small, hard-edged alpha, a 24-colour palette, no dithering.
{
  const h = 58;
  const { data, info } = await sharp('assets/previews/ui/pip_hd.png').trim().resize({ height: h, kernel: 'lanczos3' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // hard alpha: a sprite pixel is either there or not
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] > 110 ? 255 : 0;
  await sharp(data, { raw: info }).png({ palette: true, colours: 24, dither: 0 }).toFile('public/assets/retro/pip_title16.png');
  console.log('public/assets/retro/pip_title16.png', info.width, 'x', info.height);
}
