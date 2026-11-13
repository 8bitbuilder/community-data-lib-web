/**
 * /web/library-slugs.json: the slugs of the libraries in this deploy, as a JSON array.
 *
 * The library-host edge function (netlify/edge-functions/library-host.js) reads it
 * to answer an unknown subdomain with a 404 instead of rewriting to a page that
 * doesn't exist (web#31). It lists the same libraries that get pages in this build.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const slugs = (await getCollection('communities')).map((community) => community.data.slug).sort();
  return new Response(JSON.stringify(slugs), { headers: { 'Content-Type': 'application/json' } });
};
