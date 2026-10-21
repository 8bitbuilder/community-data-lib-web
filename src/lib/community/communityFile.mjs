/**
 * Read community library files (src/content/communities/<slug>.md): YAML
 * frontmatter followed by a short Markdown body. These files are the fallback
 * the build uses when it has no Netlify Database (see communityStore.mjs) and the
 * input to the one-time seed script; the database is the source of truth.
 */

import YAML from 'yaml';

/**
 * Parse a community file into { data, body }. Editor emails never belong in these
 * public files, so any old `librarian_email(s)` fields are dropped.
 */
export function parseCommunityMarkdown(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('Community file has no YAML frontmatter');
  const data = YAML.parse(match[1]) ?? {};
  delete data.librarian_email;
  delete data.librarian_emails;
  if (data.county_fips != null) data.county_fips = String(data.county_fips);
  return { data, body: match[2] };
}
