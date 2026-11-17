import { ART_PAGES, type ArtTab } from '../content/artCopy';
import { useUI } from './store';

/**
 * Addresses for the screens people can link to: the game at /, Art & Design at /art/ (one address per tab). The
 * URL decides the screen at load; opening Art & Design or changing tab updates it; back and forward work. Playing
 * stays at /. Each address also has its own static HTML at build time (vite.config.ts) for crawlers and previews.
 */
export type Route = { screen: 'menu' } | { screen: 'gallery'; tab: ArtTab };

export function parseRoute(pathname: string): Route {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const p = (pathname.startsWith(base) ? pathname.slice(base.length) : pathname).replace(/\/?$/, '/');
  const page = ART_PAGES.find((a) => a.path === p);
  return page ? { screen: 'gallery', tab: page.id } : { screen: 'menu' };
}

export function routePath(r: Route): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return base + (r.screen === 'gallery' ? ART_PAGES.find((a) => a.id === r.tab)!.path : '/');
}

/** The route the UI is showing now (the game itself counts as the title's address). */
function currentRoute(): Route {
  const s = useUI.getState();
  return s.screen === 'gallery' ? { screen: 'gallery', tab: s.galleryTab } : { screen: 'menu' };
}

let started = false;
export function startRouter() {
  if (started) return;
  started = true;
  let applying = false;
  const apply = (r: Route) => {
    applying = true;
    const ui = useUI.getState();
    if (r.screen === 'gallery') {
      ui.setGalleryTab(r.tab);
      if (ui.screen !== 'gallery') ui.setScreen('gallery');
    } else if (ui.screen === 'gallery') ui.setScreen('menu');
    applying = false;
  };
  apply(parseRoute(location.pathname));
  // an unknown path in dev (the host serves a real 404 in production): settle on the title's address
  const first = routePath(currentRoute());
  if (first !== location.pathname) history.replaceState(null, '', first + location.search);
  useUI.subscribe((s, prev) => {
    if (applying || (s.screen === prev.screen && s.galleryTab === prev.galleryTab)) return;
    const path = routePath(currentRoute());
    if (path === location.pathname) return;
    // the game's own query (dev scenarios) stays on the title's address; Art & Design addresses are clean
    history.pushState(null, '', path + (path.includes('/art/') ? '' : location.search));
  });
  window.addEventListener('popstate', () => apply(parseRoute(location.pathname)));
}
