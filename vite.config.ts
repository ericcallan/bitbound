import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { SHARE, SITE_URL } from './src/shareCopy';

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
 * Launch: build with PUBLIC=1 (drops the meta tag, robots.txt allows everyone) and remove the X-Robots-Tag
 * header from the host config.
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

export function robotsTxt(isPublic: boolean) {
  if (isPublic) return 'User-agent: *\nAllow: /\n';
  return [
    '# Bitbound is not public yet. Link previews may fetch the page; nothing may index it.',
    ...PREVIEW_BOTS.map((b) => `User-agent: ${b}\nAllow: /\n`),
    ...BLOCKED_BOTS.map((b) => `User-agent: ${b}\nDisallow: /\n`),
    'User-agent: *\nDisallow: /\n',
  ].join('\n');
}

const attr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function share(): Plugin {
  const isPublic = process.env.PUBLIC === '1';
  let base = '/';
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
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robotsTxt(isPublic) });
    },
  };
}

export default defineConfig({
  plugins: [react(), share()],
  test: { environment: 'node', include: ['src/test/**/*.test.ts'] },
} as never);
