import fs from 'node:fs';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SHARE, SITE_URL } from './src/shareCopy';
import { ART_PAGES, type ArtPage } from './src/content/artCopy';

/**
 * Sharing and search, in one place.
 *
 * Link previews (Slack, iMessage/SMS, X, Discord, LinkedIn, Facebook, WhatsApp, Telegram) need absolute URLs, so
 * the site's address (https://bitbound.world, src/shareCopy.ts) is filled into index.html at build time, so preview
 * deployments still point previews and canonical links at the real site.
 *
 * The site stays out of search engines until launch: a noindex meta tag, an X-Robots-Tag header (vercel.json,
 * netlify.toml) and robots.txt rules for search and AI crawlers. Link-preview fetchers are allowed in robots.txt
 * (X's Twitterbot, for one, honours robots.txt and would show no card otherwise); they don't index, so noindex
 * doesn't stop previews.
 *
 * Routes: the game is /, Art & Design is /art/ with one address per tab (src/content/artCopy.ts). Each art route
 * gets its own HTML file at build (dist/art/environment/index.html ...) with its own title, description,
 * canonical URL, share tags, JSON-LD and its text, so crawlers and previews see that page without running
 * JavaScript; the app then takes over (src/ui/router.ts). Also written: sitemap.xml and a static 404.html.
 *
 * Launch: build with PUBLIC=1 (drops the meta tag, robots.txt allows everyone and lists the sitemap) and remove
 * the X-Robots-Tag header from the host config.
 */
/** Fetchers that build link previews. They read a page once to draw a card; none of them index it. */
const PREVIEW_BOTS = [
  'Twitterbot',
  'facebookexternalhit',
  'Facebot',
  'Slackbot-LinkExpanding',
  'Slackbot',
  'LinkedInBot',
  'Discordbot',
  'WhatsApp',
  'TelegramBot',
  'SkypeUriPreview',
  'Pinterestbot',
  'redditbot',
  'Embedly',
];
/** Search engines and AI crawlers, named so the intent is explicit (the catch-all below covers the rest). */
const BLOCKED_BOTS = ['Googlebot', 'Bingbot', 'Applebot', 'DuckDuckBot', 'YandexBot', 'Baiduspider', 'GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'PerplexityBot', 'Bytespider', 'Amazonbot'];

/** bitbound.world (src/shareCopy.ts); SITE_URL overrides it, e.g. to test previews on a staging address. */
function siteUrl() {
  return (process.env.SITE_URL || SITE_URL).replace(/\/+$/, '');
}

export function robotsTxt(isPublic: boolean, url = siteUrl()) {
  if (isPublic) return `User-agent: *\nAllow: /\n\nSitemap: ${url}/sitemap.xml\n`;
  return [
    '# Bitbound is not public yet. Link previews may fetch the page; nothing may index it.',
    ...PREVIEW_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`),
    ...BLOCKED_BOTS.map((b) => `User-agent: ${b}\nDisallow: /\n`),
    'User-agent: *\nDisallow: /\n',
  ].join('\n');
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const ldJson = (o: unknown) => JSON.stringify(o).replace(/</g, '\\u003c');

/** The built index.html, re-addressed to one Art & Design route. */
function artHtml(html: string, page: ArtPage, url: string) {
  const pageUrl = `${url}${page.path}`;
  const alt = 'Pip, the hero of Bitbound, in all six graphics generations, from an 8-bit sprite to the Blender-built robot.';
  const ld = ldJson({
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        '@id': pageUrl,
        url: pageUrl,
        name: page.title,
        description: page.description,
        image: `${url}/og-art.jpg`,
        inLanguage: 'en',
        isPartOf: { '@type': 'WebSite', name: 'Bitbound', url: `${url}/` },
        about: { '@type': 'VideoGame', name: SHARE.title, url: `${url}/` },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Bitbound', item: `${url}/` },
          { '@type': 'ListItem', position: 2, name: 'Art & Design', item: `${url}/art/` },
          ...(page.path === '/art/' ? [] : [{ '@type': 'ListItem', position: 3, name: page.label, item: pageUrl }]),
        ],
      },
    ],
  });
  const text = [
    `<h1>Bitbound — Art &amp; Design: ${attr(page.heading)}</h1>`,
    `<p>${attr(page.intro)}</p>`,
    ...page.cards.map(
      (c) =>
        `<h2>${attr(c.title)}</h2>` +
        c.body.map((b) => `<p>${attr(b)}</p>`).join('') +
        (c.list ? `<ul>${c.list.map((l) => `<li>${attr(l)}</li>`).join('')}</ul>` : ''),
    ),
    `<nav><a href="/">Play Bitbound</a> · ${ART_PAGES.map((p) => `<a href="${p.path}">${attr(p.label)}</a>`).join(' · ')}</nav>`,
  ].join('\n      ');
  const T = attr(page.title);
  const D = attr(page.description);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${T}</title>`)
    .replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*"/g, `$1${D}"`)
    .replace(/(<meta (?:property|name)="(?:og:title|twitter:title)" content=")[^"]*"/g, `$1${T}"`)
    .replace(`<link rel="canonical" href="${url}/" />`, `<link rel="canonical" href="${pageUrl}" />`)
    .replace(`<meta property="og:url" content="${url}/" />`, `<meta property="og:url" content="${pageUrl}" />`)
    .replaceAll(`${url}/og.jpg`, `${url}/og-art.jpg`)
    // the square image is the game's; art pages share only their own wide one
    .replace(/\s*<!-- a square image[\s\S]*?<meta property="og:image:alt"[^>]*>/, '')
    .replace(/(<meta (?:property|name)="(?:og:image:alt|twitter:image:alt)" content=")[^"]*"/g, `$1${attr(alt)}"`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">${ld}</script>`)
    .replace(/<noscript>[\s\S]*?<\/noscript>/, `<noscript>\n      ${text}\n    </noscript>`);
}

function sitemapXml(url: string) {
  const day = new Date().toISOString().slice(0, 10);
  const urls = ['/', ...ART_PAGES.map((p) => p.path)];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${url}${u}</loc><lastmod>${day}</lastmod></url>`),
    '</urlset>',
    '',
  ].join('\n');
}

/** A plain page, no game: any address that isn't a route. Never indexed, even after launch. */
function notFoundHtml(base: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Page not found — Bitbound</title>
    <meta name="robots" content="noindex" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0d0b1e; color: #e6f0ff; font: 16px/1.5 system-ui, sans-serif; text-align: center; }
      h1 { font-size: 28px; margin: 0 0 8px; }
      a { color: #4fe3d4; }
    </style>
  </head>
  <body>
    <main>
      <h1>Nothing unfolded here</h1>
      <p>This page doesn't exist. <a href="${base}">Play Bitbound</a> or see the <a href="${base}art/">Art &amp; Design</a>.</p>
    </main>
  </body>
</html>
`;
}

function share(): Plugin {
  const isPublic = process.env.PUBLIC === '1';
  let base = '/';
  let outDir = 'dist';
  const url = siteUrl();
  const jsonld = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'VideoGame',
    name: SHARE.title,
    description: SHARE.description,
    url: `${url}/`,
    image: `${url}/og.jpg`,
    genre: ['Platformer', 'Puzzle'],
    gamePlatform: 'Web browser',
    applicationCategory: 'Game',
    operatingSystem: 'Any (desktop browser with WebGL 2)',
    playMode: 'SinglePlayer',
    inLanguage: 'en',
    character: { '@type': 'Person', name: 'Pip' },
  }).replace(/</g, '\\u003c');
  return {
    name: 'bitbound-share',
    configResolved(c) {
      base = c.base;
      outDir = path.resolve(c.root, c.build.outDir);
    },
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        let out = html
          .replaceAll('%SITE_URL%', url)
          .replaceAll('%BASE%', base)
          .replaceAll('%SHARE_TITLE%', attr(SHARE.title))
          .replaceAll('%SHARE_DESCRIPTION%', attr(SHARE.description))
          .replaceAll('%SHARE_IMAGE_ALT%', attr(SHARE.imageAlt))
          .replaceAll('%SHARE_JSONLD%', jsonld);
        if (isPublic) out = out.replace(/\s*<!-- share:private[\s\S]*?-->\s*<meta name="robots"[^>]*>/, '');
        return out;
      },
    },
    configureServer(server) {
      server.middlewares.use('/robots.txt', (_req, res) => {
        res.setHeader('Content-Type', 'text/plain');
        res.end(robotsTxt(isPublic));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(isPublic, url) });
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemapXml(url) });
      this.emitFile({ type: 'asset', fileName: '404.html', source: notFoundHtml(base) });
    },
    // after index.html is written: one copy per Art & Design route
    writeBundle() {
      const html = fs.readFileSync(path.join(outDir, 'index.html'), 'utf8');
      for (const page of ART_PAGES) {
        const dir = path.join(outDir, page.path);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.html'), artHtml(html, page, url));
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), share()],
  build: {
    rollupOptions: {
      output: {
        // three.js and React change far less often than the game: their own file stays cached across releases
        manualChunks: (id: string) => (/node_modules\/(three|react|react-dom|scheduler|@react-three|zustand)\//.test(id) ? 'vendor' : undefined),
      },
    },
  },
  test: { environment: 'node', include: ['src/test/**/*.test.ts'] },
} as never);
