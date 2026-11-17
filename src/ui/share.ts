import { SHARE, SITE_URL } from '../shareCopy';

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * The address to share: the game's root on bitbound.world (on a local dev server, that server), marked as a shared
 * link, never carrying a dev scenario or any other query.
 */
export function shareUrl() {
  const u = new URL(import.meta.env.BASE_URL, import.meta.env.PROD ? SITE_URL : location.origin);
  u.searchParams.set('utm_source', 'share');
  return u.toString();
}

/**
 * Share the game: the system share sheet where the browser has one (Messages, Slack, Mail...), else copy the
 * link (with the text) to the clipboard. The preview itself comes from the page's Open Graph tags.
 */
export async function shareGame(text = SHARE.description): Promise<ShareResult> {
  const data = { title: SHARE.title, text, url: shareUrl() };
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
      // anything else (not allowed here, no share targets): fall through to copying
    }
  }
  const line = `${text} ${data.url}`;
  try {
    await navigator.clipboard.writeText(line);
    return 'copied';
  } catch {
    // older browsers or a denied permission: the selection-and-copy fallback
    const ta = document.createElement('textarea');
    ta.value = line;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok ? 'copied' : 'failed';
  }
}
