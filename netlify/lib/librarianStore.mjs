/**
 * Private record of who maintains each community library, kept in Netlify Blobs
 * (store "librarians", one JSON entry per slug) so librarian emails never reach the
 * public repo or the built site. Only Netlify Functions can read it.
 *
 * Record shape:
 *   {
 *     emails: string[],                 // librarians; the first is the registrant
 *     status: 'pending' | 'approved' | 'rejected',
 *     name: string, county_fips: string,  // for duplicate checks while pending
 *     community?: object,               // submitted details, shown while pending
 *     pull_request?: number, pull_request_url?: string,
 *     created_at: string,
 *   }
 *
 * Existing libraries can be given librarians with the Netlify CLI, e.g.
 *   netlify blobs:set librarians knox-county '{"emails":["a@b.org"],"status":"approved","name":"Knox County Data Library","county_fips":"47093"}'
 */

export const LIBRARIAN_STORE_NAME = 'librarians';

/**
 * @param {{ get: Function, setJSON: Function, delete: Function, list: Function }} blobs
 *   A Netlify Blobs store (getStore(...)) or anything with the same methods.
 */
export function createLibrarianStore(blobs) {
  return {
    async get(slug) {
      return (await blobs.get(slug, { type: 'json' })) ?? null;
    },

    async set(slug, record) {
      await blobs.setJSON(slug, record);
    },

    async delete(slug) {
      await blobs.delete(slug);
    },

    /** All records as [{ slug, ...record }]. */
    async list() {
      const { blobs: entries } = await blobs.list();
      const records = await Promise.all(
        entries.map(async ({ key }) => {
          const record = await blobs.get(key, { type: 'json' });
          return record ? { slug: key, ...record } : null;
        }),
      );
      return records.filter(Boolean);
    },
  };
}
