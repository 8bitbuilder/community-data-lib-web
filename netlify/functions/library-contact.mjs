/**
 * Netlify Function: "Contact the librarian" form (/api/library-contact).
 *
 * Forwards a visitor's message to a library's editors without revealing their
 * emails (looked up in Netlify Database, table community_editors).
 *
 * Environment variables (scoped to Functions):
 *   RESEND_API_KEY        API key from resend.com (required to send)
 *   CONTACT_FROM_EMAIL    Sender, on a domain verified in Resend,
 *                         e.g. "Community Data Libraries <librarians@communitydatalibraries.org>"
 * NETLIFY_DB_URL is provided by Netlify when the site has a database.
 */

import { getDatabase } from '@netlify/database';
import { createCommunityDb } from '../lib/communityDb.mjs';
import { createContactHandler, createResendSender } from '../lib/libraryContact.mjs';

const { RESEND_API_KEY, CONTACT_FROM_EMAIL } = process.env;

let libraries = null;

export default async (request) => {
  const configured = Boolean(RESEND_API_KEY && CONTACT_FROM_EMAIL && process.env.NETLIFY_DB_URL);
  if (configured) libraries ??= createCommunityDb(getDatabase().pool);
  const handle = createContactHandler({
    libraries: configured ? libraries : null,
    send: configured ? createResendSender({ apiKey: RESEND_API_KEY, from: CONTACT_FROM_EMAIL }) : null,
  });
  return handle(request);
};

export const config = {
  path: '/api/library-contact',
};
