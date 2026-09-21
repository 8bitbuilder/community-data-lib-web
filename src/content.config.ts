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
    slug: z.string(),
    description: z.string().optional(),
    state_code: z.string().length(2),
    county: z.string().optional(),
    county_fips: z.string().regex(/^\d{5}$/).optional(),
    zip_codes: z.array(z.string().regex(/^\d{5}$/)).default([]),
    librarian_email: z.string().email().optional(),
  }),
});

const datasetsCollection = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/datasets' }),
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    source_url: z.string().url().optional().or(z.literal('')),
    community: z.string(),
    audience: z.array(z.enum(['student', 'teacher', 'community_member'])).default([]),
  }),
});

export const collections = {
  'master-library': masterLibraryCollection,
  communities: communitiesCollection,
  datasets: datasetsCollection,
};
