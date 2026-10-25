/**
 * Fail the build if any dataset coverage FIPS code or community county FIPS is
 * not in src/data/geo-vocabulary.json (the Census county list /maps draws).
 *
 * Runs in prebuild after sync:catalog, so it checks the frontmatter the site is
 * about to build from. Communities stored in Netlify Database are checked again
 * by the communities loader in src/content.config.ts.
 *
 * Usage: npm run check:geo
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createVocabulary, findUnknownGeoids } from '../src/lib/community/geoVocabulary.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(__dirname, '..');
const vocabularyPath = path.join(webRoot, 'src/data/geo-vocabulary.json');
const datasetsDir = path.join(webRoot, 'src/content/master-library');
const communitiesDir = path.join(webRoot, 'src/content/communities');

async function markdownFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
    .sort();
}

async function frontmatter(file) {
  const match = (await readFile(file, 'utf8')).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match ? (YAML.parse(match[1]) ?? {}) : {};
}

const relative = (file) => path.relative(webRoot, file).split(path.sep).join('/');

async function main() {
  const vocabulary = createVocabulary(JSON.parse(await readFile(vocabularyPath, 'utf8')));
  const datasets = [];
  for (const file of await markdownFiles(datasetsDir)) {
    datasets.push({ file: relative(file), coverage: (await frontmatter(file)).coverage ?? [] });
  }
  const communities = [];
  for (const file of await markdownFiles(communitiesDir)) {
    const data = await frontmatter(file);
    communities.push({ file: relative(file), county_fips: data.county_fips == null ? undefined : String(data.county_fips) });
  }

  const problems = findUnknownGeoids(vocabulary, { datasets, communities });
  if (problems.length > 0) {
    console.error(
      `FIPS codes not in the ${vocabulary.vintage} Census vocabulary (src/data/geo-vocabulary.json):\n` +
        problems.map((p) => `  - ${p.file}: ${p.problem}`).join('\n') +
        '\nFix dataset coverage in the backend YAML (data/sources/<id>.yml) and re-export, fix the community ' +
        'record, or bump the boundary vintage with npm run geo:boundaries.'
    );
    process.exit(1);
  }
  console.log(
    `Geo vocabulary check passed: ${datasets.length} catalog entries, ${communities.length} community files ` +
      `(Census ${vocabulary.vintage}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
