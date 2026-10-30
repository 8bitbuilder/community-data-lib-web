import type { CollectionEntry } from 'astro:content';

import {
  AUDIENCE_LABELS,
  canAudienceAccess as canAudienceAccessData,
  type AudienceRole,
} from './communityFilter';

export type { AudienceRole };

type MasterLibraryEntry = CollectionEntry<'master-library'>;

/**
 * Whether an entry appears in an audience's catalog view.
 * View customization only; not access control. Logic lives in communityFilter.ts.
 */
export function canAudienceAccess(entry: MasterLibraryEntry, audience: AudienceRole): boolean {
  return canAudienceAccessData(entry.data, audience);
}

export function audienceLabel(audience: AudienceRole): string {
  return AUDIENCE_LABELS[audience];
}

export function extractThemes(entries: MasterLibraryEntry[], audience: AudienceRole): string[] {
  return Array.from(
    new Set(
      entries
        .filter((entry) => canAudienceAccess(entry, audience))
        .flatMap((entry) =>
          entry.data.dataThemes.length > 0 ? entry.data.dataThemes : entry.data.tags
        )
    )
  ).sort((left, right) => left.localeCompare(right));
}

export function extractPedagogicalTags(entries: MasterLibraryEntry[]): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.data.pedagogicalTags))).sort(
    (left, right) => left.localeCompare(right)
  );
}
