/**
 * Pure community-library filtering and audience-view logic.
 *
 * This module has no Astro or Vite imports so it can be unit-tested with
 * Node's built-in test runner (see tests/communityFilter.test.ts).
 *
 * Audience roles customize the catalog view only. They are NOT access
 * control: every dataset remains reachable by direct URL.
 */

export type AudienceRole = 'teacher' | 'student' | 'community';

export const AUDIENCE_ROLES: readonly AudienceRole[] = ['teacher', 'student', 'community'];

export const AUDIENCE_LABELS: Record<AudienceRole, string> = {
  teacher: 'Teacher',
  student: 'Student',
  community: 'Community Member',
};

/** Normalize a role from a URL param or stored value. Accepts the legacy `community_member`. */
export function normalizeAudience(value: string | null | undefined): AudienceRole | null {
  const cleaned = (value ?? '').trim().toLowerCase();
  if (cleaned === 'community_member' || cleaned === 'community-member') return 'community';
  return (AUDIENCE_ROLES as readonly string[]).includes(cleaned) ? (cleaned as AudienceRole) : null;
}

/** The subset of catalog entry data this module needs. */
export interface CatalogEntryData {
  tags: string[];
  dataThemes: string[];
  pedagogicalTags: string[];
  audienceAccess?: { teacher: boolean; student: boolean; community: boolean };
  sensitive?: boolean;
  /** Canonical (SQLite) student classification; 'unreviewed' uses the legacy fallback. */
  studentSuitability?: StudentSuitability;
  /** Places the dataset describes: 'US', 2-digit state FIPS, or 5-digit county FIPS. */
  coverage?: CoverageEntry[];
  /** Finest geographic level the data resolves to. */
  granularity?: Granularity;
}

export type StudentSuitability = 'suitable' | 'not_suitable' | 'unreviewed';
export type Granularity = 'nation' | 'state' | 'county' | 'zip' | 'point';
export interface CoverageEntry {
  level: 'nation' | 'state' | 'county';
  geoid: string;
}

/** Levels fine enough to show county-level data for a community. */
const COUNTY_RESOLVABLE: readonly Granularity[] = ['county', 'zip', 'point'];

/** The subset of community configuration this module needs. */
export interface CommunityGeo {
  slug: string;
  state_code: string;
  county?: string;
  county_fips?: string;
}

// Legacy keyword check, used only for entries whose studentSuitability is
// 'unreviewed'. Delete it with legacyStudentFallback() once every source is reviewed.
const STUDENT_RESTRICTED_KEYWORDS = ['opioid', 'drug', 'addiction'];

const DEFAULT_ACCESS = { teacher: true, student: true, community: true };

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Keys a catalog entry can carry in its `tags` to belong to a community.
 *
 * Only used for entries without canonical coverage (hand-written guides and
 * tools); backend datasets match by their coverage FIPS codes instead, see
 * matchesCommunity(). The keys are:
 *   - the community slug            e.g. `knox-county`
 *   - the county FIPS as `fips-<n>` e.g. `fips-47093`
 *   - the slugified county name     e.g. `knox-county`
 */
export function communityGeoKeys(community: CommunityGeo): string[] {
  const keys = new Set<string>();
  if (community.slug) keys.add(slugify(community.slug));
  if (community.county_fips) keys.add(`fips-${community.county_fips}`);
  if (community.county) {
    const countyKey = slugify(community.county);
    if (countyKey) keys.add(countyKey);
  }
  return [...keys];
}

/**
 * Whether a catalog entry belongs in a community's catalog.
 *
 * Entries with canonical coverage (everything from the SQLite export):
 *   1. coverage includes the community's county FIPS -> include;
 *   2. coverage includes its state or the nation AND the data resolves to county
 *      level or finer (county, zip, point) -> include;
 *   3. otherwise exclude (e.g. state-only or national-only data).
 * Entries without coverage (hand-written guides and tools) fall back to tag matching.
 */
export function matchesCommunity(entry: CatalogEntryData, community: CommunityGeo): boolean {
  if (entry.coverage && entry.coverage.length > 0) {
    return matchesByCoverage(entry, community);
  }
  return matchesByTags(entry, community);
}

function matchesByCoverage(entry: CatalogEntryData, community: CommunityGeo): boolean {
  const countyFips = community.county_fips;
  if (!countyFips) return false;
  const stateFips = countyFips.slice(0, 2);
  const coverage = entry.coverage ?? [];
  if (coverage.some((c) => c.level === 'county' && c.geoid === countyFips)) return true;
  const coversArea = coverage.some(
    (c) => c.level === 'nation' || (c.level === 'state' && c.geoid === stateFips)
  );
  return coversArea && !!entry.granularity && COUNTY_RESOLVABLE.includes(entry.granularity);
}

function matchesByTags(entry: CatalogEntryData, community: CommunityGeo): boolean {
  const keys = communityGeoKeys(community);
  const tags = entry.tags.map((tag) => slugify(tag));
  return tags.some((tag) => keys.includes(tag));
}

export function canAudienceAccess(entry: CatalogEntryData, audience: AudienceRole): boolean {
  const access = entry.audienceAccess ?? DEFAULT_ACCESS;
  if (!access[audience]) return false;
  if (audience !== 'student') return true;
  if (entry.studentSuitability === 'suitable') return true;
  if (entry.studentSuitability === 'not_suitable') return false;
  return legacyStudentFallback(entry);
}

/**
 * Pre-classification student rule (sensitive flag + keywords). Applies only to
 * 'unreviewed' entries; remove when no source is unreviewed.
 */
export function legacyStudentFallback(entry: CatalogEntryData): boolean {
  if (entry.sensitive) return false;
  const themes = [...entry.dataThemes, ...entry.tags].map((theme) => theme.toLowerCase());
  return !themes.some((theme) =>
    STUDENT_RESTRICTED_KEYWORDS.some((keyword) => theme.includes(keyword))
  );
}

export interface RoleView {
  /** Whether the card is shown in this role's catalog view. */
  visible: boolean;
  /** Topical tags (data themes) are shown to every role. */
  showTopicalTags: boolean;
  /** Pedagogical tags are shown to teachers only. */
  showPedagogicalTags: boolean;
}

export function roleView(entry: CatalogEntryData, audience: AudienceRole): RoleView {
  return {
    visible: canAudienceAccess(entry, audience),
    showTopicalTags: true,
    showPedagogicalTags: audience === 'teacher',
  };
}

/** Space-separated list of roles that see this entry (used as a data attribute). */
export function visibleAudiences(entry: CatalogEntryData): string {
  return AUDIENCE_ROLES.filter((role) => canAudienceAccess(entry, role)).join(' ');
}

/** Topical tags for display; falls back to non-geographic tags when themes are empty. */
export function topicalTags(entry: CatalogEntryData, community?: CommunityGeo): string[] {
  if (entry.dataThemes.length > 0) return entry.dataThemes;
  const geoKeys = community ? communityGeoKeys(community) : [];
  return entry.tags.filter((tag) => !geoKeys.includes(slugify(tag)));
}

/** Display strings for a community library, derived from its configuration. */
export interface CommunityNames {
  name: string;
  place_name?: string;
}

export function communityDisplay(community: CommunityNames): {
  placeName: string;
  libraryTitle: string;
  welcomeHeading: string;
} {
  const place = community.place_name?.trim();
  return {
    placeName: place || community.name,
    // e.g. "Knoxville Community Data Library"; falls back to the configured name.
    libraryTitle: place ? `${place} Community Data Library` : community.name,
    welcomeHeading: `Welcome to ${place || community.name}`,
  };
}
