/**
 * Rebuild the static site after a librarian write that changes public pages.
 *
 * COMMUNITY_BUILD_HOOK_URL is a Netlify build hook (Site configuration > Build &
 * deploy > Build hooks). Each call starts a production build and deploy, which
 * costs build minutes and deploy credits, so only approvals and edits to approved
 * libraries call it (see rebuildReason in src/lib/community/librarianRules.mjs).
 * Without the variable, the write still succeeds and the rebuild is skipped with
 * a warning.
 */

/**
 * @param {object} options
 * @param {string | undefined} options.url
 * @param {typeof fetch} [options.fetch]
 * @param {{ warn: Function, error: Function }} [options.log]
 * @returns {(reason: string) => Promise<'triggered' | 'skipped' | 'failed'>}
 */
export function createBuildHook({ url, fetch = globalThis.fetch, log = console }) {
  return async function rebuild(reason) {
    if (!url) {
      log.warn(`COMMUNITY_BUILD_HOOK_URL is not set; skipping the site rebuild (${reason}).`);
      return 'skipped';
    }
    try {
      const target = new URL(url);
      target.searchParams.set('trigger_title', reason);
      const response = await fetch(target, { method: 'POST' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return 'triggered';
    } catch (err) {
      log.error(`Build hook failed (${reason}):`, err);
      return 'failed';
    }
  };
}
