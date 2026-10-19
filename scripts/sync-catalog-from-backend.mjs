/**
 * Sync backend YAML sources into master-library content collection entries.
 *
 * Usage (from web repo root):
 *   npm run sync:backend-yaml   # mirror canonical backend YAML first
 *   npm run sync:catalog
 *
 * Reads canonical backend sources (BACKEND_SOURCES_DIR or ../backend/data/sources).
 * Falls back to web/backend/data/sources if canonical path is unavailable.
 */

import { mkdir, readdir, readFile, stat, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import {
  getCanonicalExportsDir,
  getCanonicalSourcesDir,
  getWebExportsDir,
  getWebSourcesDir,
} from './backend-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.resolve(__dirname, '../src/content/master-library/datasets');

async function resolveSourcesDir() {
  const canonical = getCanonicalSourcesDir();
  try {
    const info = await stat(canonical);
    if (info.isDirectory()) return canonical;
  } catch {
    // fall through
  }
  const webMirror = getWebSourcesDir();
  try {
    await stat(webMirror);
    console.warn(`Using web mirror (canonical not found): ${webMirror}`);
    return webMirror;
  } catch {
    throw new Error(
      `No backend sources found. Set BACKEND_SOURCES_DIR or run npm run sync:backend-yaml`,
    );
  }
}

function normalizeDescriptionTags(tags) {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t).trim()).filter(Boolean);
  if (typeof tags === 'object') {
    return Object.entries(tags)
      .filter(([, active]) => active)
      .map(([name]) => String(name).trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * Load catalog sources, preferring the SQLite export (backend data/exports/catalog.json,
 * then the committed web mirror). Falls back to reading YAML directly, with a warning.
 */
export async function loadCatalogSources() {
  for (const dir of [getCanonicalExportsDir(), getWebExportsDir()]) {
    const file = path.join(dir, 'catalog.json');
    let raw;
    try {
      raw = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    const exported = JSON.parse(raw);
    // Analysis tag sets are nested in the export; flatten them to the YAML shape.
    const sources = exported.sources.map(({ analysis_tags: analysis = {}, ...rest }) => ({
      ...analysis,
      ...rest,
    }));
    return { sources, origin: `SQLite export ${file}` };
  }

  const sourcesDir = await resolveSourcesDir();
  console.warn('WARNING: no SQLite export found; reading YAML directly. Run export_catalog.py.');
  const sources = [];
  for (const file of await listSourceFiles(sourcesDir)) {
    sources.push(YAML.parse(await readFile(path.join(sourcesDir, file), 'utf8')));
  }
  return { sources, origin: `YAML ${sourcesDir}` };
}

// All active analysis tags: the catalog's pedagogical filter needs every one, and
// cards only display the first few anyway.
export function extractPedagogicalTags(source) {
  // Curated pedagogical tags come first and keep their exact names.
  const tags = Object.entries(source.pedagogical_tags ?? {})
    .filter(([, active]) => active)
    .map(([name]) => name);
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith('_tags') || key === 'description_tags' || key === 'pedagogical_tags' || key === 'manual_tags') continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    for (const [tagName, active] of Object.entries(value)) {
      if (active) tags.push(tagName.replace(/-/g, ' '));
    }
  }
  return [...new Set(tags)];
}

function variableCount(source) {
  return (source.variables ?? source.variable_names ?? []).length;
}

function buildDescription(source) {
  const provider = source.provider?.name ?? 'a government data provider';
  const agency = source.provider?.agency;
  const themes = normalizeDescriptionTags(source.description_tags);

  const intro = agency
    ? `${source.title} from ${provider} (${agency}).`
    : `${source.title} from ${provider}.`;

  const themeSentence =
    themes.length > 0
      ? ` Topics include ${themes.slice(0, 5).join(', ')}${themes.length > 5 ? ', and more' : ''}.`
      : '';

  const accessNote = source.requires_account
    ? ' A free provider account is required to download the full dataset.'
    : source.download?.url
      ? ' Data is available for direct download.'
      : source.download?.description
        ? ` ${source.download.description}`
        : '';

  const detail = source.notes
    ? ` ${source.notes.length > 200 ? `${source.notes.slice(0, 197)}...` : source.notes}`
    : '';

  return (intro + themeSentence + accessNote + detail).replace(/\s+/g, ' ').trim();
}

// Only tags the backend actually records — no invented placeholders.
function buildTags(source, themes) {
  const tags = new Set(themes);
  if (source.filters?.state) tags.add('state');
  if (source.filters?.county) tags.add('county');
  if (source.filters?.year) tags.add('year');
  if (source.requires_account) tags.add('account-required');
  return [...tags];
}

function inferDifficulty(source) {
  if (source.requires_account) return 'advanced';
  const count = variableCount(source);
  if (count > 30) return 'advanced';
  if (count > 15) return 'intermediate';
  return 'beginner';
}

function yamlQuote(value) {
  const text = String(value);
  if (text.includes('"') || text.includes(':') || text.includes('\n')) {
    return JSON.stringify(text);
  }
  return `"${text}"`;
}

function buildMarkdown(source) {
  const themes = normalizeDescriptionTags(source.description_tags);
  const pedagogicalTags = extractPedagogicalTags(source);
  const description = source.description ?? buildDescription(source);
  const tags = buildTags(source, themes);
  // Keep the backend's tag names as-is (e.g. "Energy & Environment") so the
  // catalog shows the same tags as Data Preview.
  const dataThemes = themes;
  const author = source.provider?.name ?? 'Unknown provider';
  const url = source.provider?.url ?? source.download?.url ?? '';
  const difficulty = inferDifficulty(source);

  const coverage = Array.isArray(source.coverage) ? source.coverage : [];
  const location = source.location;

  const lines = [
    '---',
    `title: ${yamlQuote(source.title)}`,
    `description: ${yamlQuote(description)}`,
    `author: ${yamlQuote(author)}`,
    `sourceId: ${yamlQuote(source.id)}`,
    `category: "dataset"`,
    `syncedFromBackend: true`,
    'tags:',
    ...tags.map((t) => `  - ${yamlQuote(t)}`),
    // No placeholder tags: empty lists stay empty.
    ...(dataThemes.length ? ['dataThemes:', ...dataThemes.map((t) => `  - ${yamlQuote(t)}`)] : ['dataThemes: []']),
    ...(pedagogicalTags.length
      ? ['pedagogicalTags:', ...pedagogicalTags.map((t) => `  - ${yamlQuote(t)}`)]
      : ['pedagogicalTags: []']),
    `sensitive: ${source.sensitive === true}`,
    `studentSuitability: ${yamlQuote(source.student_suitability ?? 'unreviewed')}`,
    ...(source.geographic_granularity
      ? [`granularity: ${yamlQuote(source.geographic_granularity)}`]
      : []),
    ...(coverage.length
      ? [
          'coverage:',
          ...coverage.map(
            (c) => `  - { level: ${yamlQuote(c.level)}, geoid: ${yamlQuote(c.geoid ?? c.fips ?? 'US')} }`
          ),
        ]
      : []),
    ...(location
      ? [
          'location:',
          `  latitude: ${Number(location.latitude)}`,
          `  longitude: ${Number(location.longitude)}`,
          ...(location.label ? [`  label: ${yamlQuote(location.label)}`] : []),
        ]
      : []),
    ...(source.published_date ? [`publishedDate: ${source.published_date}`] : []),
    ...(url ? [`url: ${yamlQuote(url)}`] : []),
    'featured: false',
    `difficulty: ${yamlQuote(difficulty)}`,
    'language: "English"',
    '---',
    '',
    ...(source.about
      ? [source.about.trim(), '']
      : [
          `${source.title} — synced from the backend source catalog (\`${source.id}\`).`,
          '',
          'Use the **Data Preview** page to explore column statistics, geographic filters, and sample rows.',
          '',
        ]),
  ];

  if (source.requires_account) {
    lines.push('> **Note:** This provider requires a free account to download the full dataset.', '');
  }

  return lines.join('\n');
}

async function listSourceFiles(sourcesDir) {
  const names = await readdir(sourcesDir);
  const files = names.filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'));
  for (const name of names) {
    const fullPath = path.join(sourcesDir, name);
    const info = await stat(fullPath);
    if (info.isFile() && !name.includes('.') && !files.includes(name)) {
      files.push(name);
    }
  }
  return files.sort();
}

async function main() {
  const { sources, origin } = await loadCatalogSources();

  await mkdir(outputDir, { recursive: true });

  const written = [];
  for (const source of sources) {
    if (!source?.id || !source?.title) {
      console.warn(`Skipping source: missing id or title (${source?.id ?? 'unknown'})`);
      continue;
    }
    const outPath = path.join(outputDir, `${source.id}.md`);
    await writeFile(outPath, buildMarkdown(source), 'utf8');
    written.push(source.id);
  }

  const existing = (await readdir(outputDir)).filter((f) => f.endsWith('.md'));
  for (const file of existing) {
    const id = file.replace(/\.md$/, '');
    if (!written.includes(id)) {
      await rm(path.join(outputDir, file));
      console.log(`Removed stale entry: ${file}`);
    }
  }

  console.log(`Synced ${written.length} dataset(s) from ${origin}`);
  console.log(`  → ${outputDir}`);
}

// Run only when executed directly (the loader above is also imported by build-map-markers.mjs).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
