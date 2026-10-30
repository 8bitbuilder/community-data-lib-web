/**
 * Fail if web/backend/data/sources diverges from the canonical backend copy.
 *
 * Usage: node scripts/check-backend-yaml-sync.mjs
 */

import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  getCanonicalExportsDir,
  getCanonicalSourcesDir,
  getWebExportsDir,
  getWebSourcesDir,
} from './backend-paths.mjs';

async function listSourceFiles(dir) {
  const names = await readdir(dir);
  const files = names.filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'));
  for (const name of names) {
    const fullPath = path.join(dir, name);
    const info = await stat(fullPath);
    if (info.isFile() && !name.includes('.') && !files.includes(name)) {
      files.push(name);
    }
  }
  return files.sort();
}

async function fileHash(filePath) {
  const data = await readFile(filePath);
  return createHash('sha256').update(data).digest('hex');
}

async function main() {
  const canonicalDir = getCanonicalSourcesDir();
  const webDir = getWebSourcesDir();

  let canonicalFiles;
  try {
    canonicalFiles = await listSourceFiles(canonicalDir);
  } catch {
    console.warn(`Canonical backend sources not found: ${canonicalDir}`);
    console.warn('Skipping sync check — no canonical source to compare against.');
    console.warn('Set BACKEND_SOURCES_DIR or BACKEND_ROOT to enable this check.');
    process.exit(0);
  }

  let webFiles;
  try {
    webFiles = await listSourceFiles(webDir);
  } catch {
    console.error(`web/backend mirror missing. Run: npm run sync:backend-yaml`);
    process.exit(1);
  }

  const mismatches = [];

  if (canonicalFiles.join('|') !== webFiles.join('|')) {
    const onlyCanonical = canonicalFiles.filter((f) => !webFiles.includes(f));
    const onlyWeb = webFiles.filter((f) => !canonicalFiles.includes(f));
    if (onlyCanonical.length) mismatches.push(`Missing in web mirror: ${onlyCanonical.join(', ')}`);
    if (onlyWeb.length) mismatches.push(`Extra in web mirror: ${onlyWeb.join(', ')}`);
  }

  for (const file of canonicalFiles) {
    const [canonicalHash, webHash] = await Promise.all([
      fileHash(path.join(canonicalDir, file)),
      fileHash(path.join(webDir, file)).catch(() => null),
    ]);
    if (canonicalHash !== webHash) {
      mismatches.push(`Content differs: ${file}`);
    }
  }

  // The SQLite export must match too (compared ignoring CRLF/LF differences).
  const readNormalized = (p) => readFile(p, 'utf8').then((t) => t.replace(/\r\n/g, '\n'));
  const canonicalExport = await readNormalized(path.join(getCanonicalExportsDir(), 'catalog.json')).catch(() => null);
  if (canonicalExport !== null) {
    const webExport = await readNormalized(path.join(getWebExportsDir(), 'catalog.json')).catch(() => null);
    if (webExport !== canonicalExport) mismatches.push('SQLite export differs: data/exports/catalog.json');
  }

  if (mismatches.length > 0) {
    console.error('Backend YAML mirror is out of sync with canonical backend:');
    for (const msg of mismatches) console.error(`  - ${msg}`);
    console.error('\nRun: npm run sync:backend-yaml');
    process.exit(1);
  }

  console.log(`Backend YAML mirror OK (${canonicalFiles.length} file(s))`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
