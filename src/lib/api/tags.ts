import type { BackendSource } from './backend';

// Kept separate from backend.ts so it can be unit-tested without Vite's import.meta.env.
export function getPedagogicalTags(source: BackendSource, limit = 8): string[] {
  const tags: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith('_tags') || key === 'description_tags' || key === 'manual_tags') continue;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
    for (const [tagName, active] of Object.entries(value as Record<string, boolean>)) {
      if (active) tags.push(tagName.replace(/-/g, ' '));
    }
  }
  return tags.slice(0, limit);
}
