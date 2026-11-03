import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import geoVocabulary from './data/geo-vocabulary.json';
import { createVocabulary } from './lib/community/geoVocabulary.mjs';
import { loadCommunities } from './lib/community/communityStore.mjs';

const masterLibraryCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/master-library' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    author: z.string().optional(),
    publishedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    dataThemes: z.array(z.string()).default([]),
    pedagogicalTags: z.array(z.string()).default([]),
    category: z.string().optional(),
    difficulty: z.string().optional(),
    sourceId: z.string().optional(),
    syncedFromBackend: z.boolean().default(false),
    audienceAccess: z
      .object({
        teacher: z.boolean().default(true),
        student: z.boolean().default(true),
        community: z.boolean().default(true),
      })
      .default({
        teacher: true,
        student: true,
        community: true,
      }),
    sensitive: z.boolean().default(false),
    // Canonical fields from the SQLite export (see backend database/schema.sql).
    // 'unreviewed' uses the legacy student heuristics in communityFilter.ts.
    studentSuitability: z.enum(['suitable', 'not_suitable', 'unreviewed']).default('unreviewed'),
    granularity: z.enum(['nation', 'state', 'county', 'tract', 'zip', 'point']).optional(),
    coverage: z
      .array(
        z.object({
          level: z.enum(['nation', 'state', 'county']),
          geoid: z.string().regex(/^(US|\d{2}|\d{5})$/),
        })
      )
      .default([]),
    url: z.string().url().optional(),
    fileUrl: z.string().url().optional(),
    featured: z.boolean().default(false),
    language: z.string().optional(),
  }),
});

// Community libraries come from Netlify Database when the build has one
// (NETLIFY_DB_URL), otherwise from src/content/communities/*.md with a loud
// warning; see src/lib/community/communityStore.mjs. State code and county name
// are derived from county_fips with the Census vocabulary, not stored.
const communitiesCollection = defineCollection({
  loader: async () =>
    (
      await loadCommunities({
        vocabulary: createVocabulary(geoVocabulary),
        dir: './src/content/communities',
      })
    ).map((community) => ({ id: community.slug, ...community })),
  schema: z.object({
    name: z.string(),
    place_name: z.string().optional(),
    slug: z.string(),
    description: z.string().optional(),
    county_fips: z.string().regex(/^\d{5}$/),
    state_code: z.string().length(2),
    county: z.string(),
    state_name: z.string(),
    // Editor emails are deliberately not here: they live in Netlify Database
    // (community_editors) and are only read by the librarian functions.
  }),
});

export const collections = {
  'master-library': masterLibraryCollection,
  communities: communitiesCollection,
};
