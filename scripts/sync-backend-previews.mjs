/**
 * Copy the backend's Tier 1 preview files (data/exports/previews, written by
 * pythonscripts/export_previews.py) into public/previews/ so the static Data
 * Preview page can fetch them. public/previews/ is gitignored: the backend repo
 * is the only committed copy (Netlify clones it for every build).
 *
 * Without a backend checkout (e.g. CI), this warns and leaves no previews; the
 * Data Preview page then shows its info-only view for every dataset.
 *
 * Usage: npm run sync:previews
 */

import { copyFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCanonicalExportsDir } from './backend-paths.mjs';

// Matches MAX_FILE_BYTES in the backend exporter; Netlify serves these straight from the CDN.
export const MAX_PREVIEW_BYTES = 250_000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const targetDir = path.resolve(__dirname, '../public/previews');

/** Map of relative path -> fs.Stats for every file under dir (empty if dir is missing). */
async function listFiles(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
  const files = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    files.set(path.relative(dir, full), await stat(full));
  }
  return files;
}

async function main() {
  const sourceDir = path.join(getCanonicalExportsDir(), 'previews');
  try {
    await stat(path.join(sourceDir, 'index.json'));
  } catch {
    await rm(targetDir, { recursive: true, force: true });
    console.warn('');
    console.warn(`WARNING: no Tier 1 previews found at ${sourceDir}`);
    console.warn('The Data Preview page will show dataset details without data previews.');
    console.warn('Set BACKEND_ROOT to a backend checkout that has data/exports/previews.');
    console.warn('');
    return;
  }

  const sources = await listFiles(sourceDir);
  const oversized = [...sources]
    .filter(([, info]) => info.size > MAX_PREVIEW_BYTES)
    .map(([relative, info]) => `${relative} (${info.size} bytes)`);
  if (oversized.length > 0) {
    throw new Error(
      `Preview files over ${MAX_PREVIEW_BYTES} bytes (re-run the backend export_previews.py):\n  ${oversized.join('\n  ')}`
    );
  }

  // Incremental: thousands of small files, so only copy what changed and drop what left.
  const existing = await listFiles(targetDir);
  let copied = 0;
  for (const [relative, info] of sources) {
    const current = existing.get(relative);
    if (current && current.size === info.size && current.mtimeMs >= info.mtimeMs) continue;
    const dest = path.join(targetDir, relative);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(path.join(sourceDir, relative), dest);
    copied += 1;
  }
  let removed = 0;
  for (const relative of existing.keys()) {
    if (!sources.has(relative)) {
      await rm(path.join(targetDir, relative));
      removed += 1;
    }
  }
  const bytes = [...sources.values()].reduce((sum, info) => sum + info.size, 0);
  console.log(
    `Preview files: ${sources.size} (${(bytes / 1e6).toFixed(1)} MB) from ${sourceDir}; ` +
      `${copied} copied, ${removed} removed, ${sources.size - copied} unchanged`
  );
  console.log(`  → ${targetDir}`);
}

main().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
