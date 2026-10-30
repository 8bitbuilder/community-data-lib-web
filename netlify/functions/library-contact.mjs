/**
 * Netlify Function: "Contact the librarian" form (/api/library-contact).
 *
 * Forwards a visitor's message to a library's librarians without revealing their
 * emails (looked up in the private Netlify Blobs store "librarians").
 *
 * Environment variables (scoped to Functions):
 *   RESEND_API_KEY        API key from resend.com (required to send)
 *   CONTACT_FROM_EMAIL    Sender, on a domain verified in Resend,
 *                         e.g. "Community Data Libraries <librarians@communitydatalibraries.org>"
 *   LIBRARIAN_GITHUB_*    Optional; lets a just-approved library receive mail right away
 *                         (see librarian-api.mjs).
 */

import { getStore } from '@netlify/blobs';
import { createGitHubCommunityStore } from '../lib/githubCommunityStore.mjs';
import { createContactHandler, createResendSender } from '../lib/libraryContact.mjs';
import { createLibrarianStore, LIBRARIAN_STORE_NAME } from '../lib/librarianStore.mjs';

const { RESEND_API_KEY, CONTACT_FROM_EMAIL, LIBRARIAN_GITHUB_TOKEN } = process.env;

export default async (request) => {
  const configured = Boolean(RESEND_API_KEY && CONTACT_FROM_EMAIL);
  const github = LIBRARIAN_GITHUB_TOKEN
    ? createGitHubCommunityStore({
        token: LIBRARIAN_GITHUB_TOKEN,
        repo: process.env.LIBRARIAN_GITHUB_REPO || 'community-data-libraries/web',
        branch: process.env.LIBRARIAN_GITHUB_BRANCH || 'main',
      })
    : null;
  const handle = createContactHandler({
    librarians: configured
      ? createLibrarianStore(getStore({ name: LIBRARIAN_STORE_NAME, consistency: 'strong' }))
      : null,
    send: configured ? createResendSender({ apiKey: RESEND_API_KEY, from: CONTACT_FROM_EMAIL }) : null,
    isLive: github ? (slug) => github.get(slug) : null,
  });
  return handle(request);
};

export const config = {
  path: '/api/library-contact',
};
