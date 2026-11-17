// Checks the built site (dist/) is ready to be shared and still hidden from search engines.
//   npm run build && node scripts/check-share.mjs        (PUBLIC=1 to check a launch build instead)
import fs from 'node:fs';
import sharp from 'sharp';

const dist = 'dist';
const html = fs.readFileSync(`${dist}/index.html`, 'utf8');
const isPublic = process.env.PUBLIC === '1';
const fails = [];
const ok = (cond, msg) => (cond ? null : fails.push(msg));
const meta = (attr, key) => {
  const m = html.match(new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`));
  return m ? m[1] : null;
};
const abs = (u) => /^https?:\/\/[^/]+/.test(u ?? '');

for (const k of ['og:type', 'og:site_name', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:secure_url', 'og:image:width', 'og:image:height', 'og:image:alt'])
  ok(meta('property', k), `missing ${k}`);
for (const k of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image', 'twitter:image:alt']) ok(meta('name', k), `missing ${k}`);
for (const k of ['description', 'theme-color', 'application-name']) ok(meta('name', k), `missing ${k}`);
ok(meta('name', 'twitter:card') === 'summary_large_image', 'twitter:card should be summary_large_image');
ok(abs(meta('property', 'og:image')) && abs(meta('property', 'og:url')) && abs(meta('name', 'twitter:image')), 'share URLs must be absolute');
ok(!/%[A-Z_]+%/.test(html), 'unfilled placeholder in index.html');
ok(/<link rel="canonical" href="https?:\/\//.test(html), 'missing absolute canonical link');
ok(/<link rel="manifest"/.test(html) && /<link rel="apple-touch-icon"/.test(html) && /<link rel="icon"/.test(html), 'missing icon or manifest links');
const desc = meta('property', 'og:description') ?? '';
ok(desc.length >= 60 && desc.length <= 200, `og:description should be 60-200 characters (is ${desc.length})`);

// JSON-LD parses and describes a video game
const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
try {
  const j = JSON.parse(ld[1]);
  ok(j['@type'] === 'VideoGame' && abs(j.image), 'JSON-LD should be a VideoGame with an absolute image');
} catch {
  fails.push('JSON-LD missing or invalid');
}

// the images exist at the declared sizes, small enough for every unfurler
for (const [f, w, h] of [['og.jpg', 1200, 630], ['og-square.jpg', 1200, 1200], ['icon-192.png', 192, 192], ['icon-512.png', 512, 512], ['apple-touch-icon.png', 180, 180]]) {
  const p = `${dist}/${f}`;
  if (!fs.existsSync(p)) {
    fails.push(`missing ${f}`);
    continue;
  }
  const m = await sharp(p).metadata();
  ok(m.width === w && m.height === h, `${f} is ${m.width}x${m.height}, expected ${w}x${h}`);
  if (f.startsWith('og')) ok(fs.statSync(p).size < 300 * 1024, `${f} is over 300 KB`);
}

// manifest icons exist
const man = JSON.parse(fs.readFileSync(`${dist}/site.webmanifest`, 'utf8'));
for (const i of man.icons) ok(fs.existsSync(`${dist}/${i.src}`), `manifest icon missing: ${i.src}`);

// search engines kept out (unless this is a launch build), link previews let in
const robots = fs.readFileSync(`${dist}/robots.txt`, 'utf8');
const section = (agent) => robots.split(/\n(?=User-agent:)/).find((b) => b.startsWith(`User-agent: ${agent}\n`)) ?? '';
if (isPublic) {
  ok(!/<meta name="robots"/.test(html), 'launch build still has the noindex meta tag');
  ok(/Allow: \//.test(section('*')), 'launch robots.txt should allow everyone');
} else {
  ok(/<meta name="robots" content="noindex/.test(html), 'missing noindex meta tag');
  for (const a of ['*', 'Googlebot', 'Bingbot', 'GPTBot']) ok(/Disallow: \//.test(section(a)), `robots.txt should disallow ${a}`);
  for (const a of ['Twitterbot', 'Slackbot-LinkExpanding', 'facebookexternalhit', 'Discordbot', 'LinkedInBot']) ok(/Allow: \//.test(section(a)), `robots.txt should allow ${a}`);
  for (const f of ['vercel.json', 'netlify.toml']) ok(/X-Robots-Tag/.test(fs.readFileSync(f, 'utf8')), `${f} should send X-Robots-Tag`);
}

if (fails.length) {
  console.error('share check FAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log(`share check ok: ${meta('property', 'og:url')} (${isPublic ? 'public' : 'hidden from search'})`);
