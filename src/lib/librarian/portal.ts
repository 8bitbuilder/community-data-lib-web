/**
 * Pure helpers for the /librarian/ pages (no DOM, no Identity), so they run under node:test.
 */

/**
 * Where to go after logging in. Only pages of the librarian portal on this site are
 * allowed, so a crafted ?next= link cannot send people elsewhere.
 */
export function safeNext(next: string | null | undefined, portalBase: string): string {
  const value = String(next ?? '');
  const base = portalBase.endsWith('/') ? portalBase : `${portalBase}/`;
  if (!value.startsWith(base) || value.startsWith('//') || /[\\\r\n]/.test(value)) return base;
  return value;
}

/**
 * The library an edit page is for: /web/librarian/<slug>/edit/ on Netlify (rewritten
 * to the one static edit page), or ?slug=<slug> (local development).
 */
export function editSlugFromLocation(pathname: string, search: string): string | null {
  const match = pathname.match(/\/librarian\/([a-z0-9]+(?:-[a-z0-9]+)*)\/edit\/?$/);
  if (match) return match[1];
  const slug = new URLSearchParams(search).get('slug')?.trim().toLowerCase() ?? '';
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) ? slug : null;
}

/** [GEOID, county name, state name, USPS code] as embedded in the county picker. */
export type CountyOption = [string, string, string, string];

export function countyLabel([, county, state]: CountyOption): string {
  return `${county}, ${state}`;
}

const fold = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Counties matching what someone typed: every word must appear in the county name,
 * state name, state code or FIPS code ("knox tn", "knox tennessee", "47093").
 * Counties whose name starts with the first word come first.
 */
export function searchCounties(options: CountyOption[], query: string, limit = 20): CountyOption[] {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return [];
  const matches: { option: CountyOption; rank: number }[] = [];
  for (const option of options) {
    const [geoid, county, state, usps] = option;
    const haystack = ` ${fold(county)} ${fold(state)} ${usps.toLowerCase()} ${geoid} `;
    if (!words.every((word) => haystack.includes(` ${word}`))) continue;
    matches.push({ option, rank: fold(county).startsWith(words[0]) ? 0 : 1 });
  }
  return matches
    .sort((a, b) => a.rank - b.rank || countyLabel(a.option).localeCompare(countyLabel(b.option)))
    .slice(0, limit)
    .map((m) => m.option);
}
