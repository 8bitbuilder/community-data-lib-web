/**
 * Read and write community library files (src/content/communities/<slug>.md):
 * YAML frontmatter matching the `communities` schema in src/content.config.ts,
 * followed by a short Markdown body.
 */

import YAML from 'yaml';
import { SLUG_PATTERN } from './librarianRules.mjs';

export const COMMUNITIES_DIR = 'src/content/communities';

const FIELD_ORDER = [
  'name',
  'place_name',
  'slug',
  'description',
  'state_code',
  'county',
  'county_fips',
  'zip_codes',
];

/** Repo path of a community file. Throws on an unsafe slug so no other path can be written. */
export function communityPath(slug) {
  if (!SLUG_PATTERN.test(String(slug ?? ''))) throw new Error(`Invalid community slug: ${slug}`);
  return `${COMMUNITIES_DIR}/${slug}.md`;
}

/**
 * Parse a community file into { data, body }. Librarian emails never belong in these
 * public files, so any old `librarian_email(s)` fields are dropped.
 */
export function parseCommunityMarkdown(markdown) {
  const match = String(markdown).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error('Community file has no YAML frontmatter');
  const data = YAML.parse(match[1]) ?? {};
  delete data.librarian_email;
  delete data.librarian_emails;
  if (data.county_fips != null) data.county_fips = String(data.county_fips);
  data.zip_codes = (data.zip_codes ?? []).map(String);
  return { data, body: match[2] };
}

/** Serialize a community record (and optional body) back to the file format. */
export function serializeCommunityMarkdown(community, body) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    const value = community[key];
    if (value === undefined || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    ordered[key] = value;
  }
  const text = body?.trim() ? body.trim() : `Community data library hub for ${community.name}.`;
  return `---\n${YAML.stringify(ordered)}---\n\n${text}\n`;
}
