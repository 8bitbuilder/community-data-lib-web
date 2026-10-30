/**
 * Client-side audience (role) state for community libraries.
 *
 * Mechanism: the `?audience=` URL parameter, the convention already used by
 * /complete-catalog and /data-preview. The value is mirrored to
 * sessionStorage so nav links within the community library can carry it.
 * The role only customizes which cards and tags are shown. It is not
 * authentication or access control.
 *
 * Analytics hook: every role selection dispatches a `cdl:audience-change`
 * event on `document` with `{ audience }` in `detail`. A future analytics
 * script can listen for it; no analytics dependency is included.
 */
import { normalizeAudience, type AudienceRole } from '../data/communityFilter';

const STORAGE_KEY = 'cdl:audience';

function storedAudience(): AudienceRole | null {
  try {
    return normalizeAudience(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    return null; // storage unavailable (privacy mode, disabled cookies)
  }
}

export function saveAudience(audience: AudienceRole): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, audience);
  } catch {
    // Non-fatal: the URL parameter still carries the role.
  }
}

/** Role from the URL if present (and remembered), else the remembered role, else null. */
export function currentAudience(): AudienceRole | null {
  const fromUrl = normalizeAudience(new URLSearchParams(window.location.search).get('audience'));
  if (fromUrl) {
    saveAudience(fromUrl);
    return fromUrl;
  }
  return storedAudience();
}

/** Record a role the visitor just chose: remember it, reflect it in the URL, announce it. */
export function selectAudience(audience: AudienceRole): void {
  saveAudience(audience);
  const url = new URL(window.location.href);
  url.searchParams.set('audience', audience);
  window.history.replaceState(null, '', url);
  applyAudienceToLinks(audience);
  document.dispatchEvent(new CustomEvent('cdl:audience-change', { detail: { audience } }));
}

/** Add `?audience=` to every link marked with `data-carry-audience`. */
export function applyAudienceToLinks(audience: AudienceRole, root: ParentNode = document): void {
  root.querySelectorAll<HTMLAnchorElement>('a[data-carry-audience]').forEach((link) => {
    const url = new URL(link.href, window.location.href);
    url.searchParams.set('audience', audience);
    link.href = url.toString();
  });
}
