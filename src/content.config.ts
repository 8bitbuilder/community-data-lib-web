import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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
    granularity: z.enum(['nation', 'state', 'county', 'zip', 'point']).optional(),
    coverage: z
      .array(
        z.object({
          level: z.enum(['nation', 'state', 'county']),
          geoid: z.string().regex(/^(US|\d{2}|\d{5})$/),
        })
      )
      .default([]),
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        label: z.string().optional(),
      })
      .optional(),
    url: z.string().url().optional(),
    fileUrl: z.string().url().optional(),
    featured: z.boolean().default(false),
    language: z.string().optional(),
  }),
});

const communitiesCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/communities' }),
  schema: z.object({
    name: z.string(),
    place_name: z.string().optional(),
    slug: z.string(),
    description: z.string().optional(),
    state_code: z.string().length(2),
    county: z.string().optional(),
    county_fips: z
      .string()
      .regex(/^\d{5}$/)
      .optional(),
    zip_codes: z.array(z.string().regex(/^\d{5}$/)).default([]),
    // Librarian emails are deliberately not here: these files are public, so the
    // librarian portal keeps them in Netlify Blobs (see netlify/lib/librarianStore.mjs).
  }),
});

export const collections = {
  'master-library': masterLibraryCollection,
  communities: communitiesCollection,
};
