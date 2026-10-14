/**
 * Netlify Function: librarian portal API (/api/librarian/*).
 *
 * Lets community librarians register and edit their community library files
 * (src/content/communities/*.md). Logins come from Netlify Identity. New libraries
 * open a pull request for the team to approve; edits to approved libraries are
 * committed to GitHub, which triggers a rebuild. Librarian emails are kept private
 * in Netlify Blobs (store "librarians").
 *
 * Environment variables (Netlify > Site configuration > Environment variables,
 * scoped to Functions):
 *   LIBRARIAN_GITHUB_TOKEN   Fine-grained token with Contents and Pull requests read/write (required)
 *   LIBRARIAN_GITHUB_REPO    "owner/name" (default community-data-libraries/web)
 *   LIBRARIAN_GITHUB_BRANCH  Branch the site deploys from (default main)
 *   LIBRARIAN_IDENTITY_URL   Identity service to verify logins against (default: this site's
 *                            /.netlify/identity). Set it for `netlify dev`, where localhost has none.
 */

import { getStore } from '@netlify/blobs';
import { createGitHubCommunityStore } from '../lib/githubCommunityStore.mjs';
import { createIdentityVerifier } from '../lib/identity.mjs';
import { createLibrarianHandler } from '../lib/librarianApi.mjs';
import { createLibrarianStore, LIBRARIAN_STORE_NAME } from '../lib/librarianStore.mjs';

const token = process.env.LIBRARIAN_GITHUB_TOKEN;

function getHandler() {
  // Built per request: Netlify provides the Blobs context to each invocation.
  return createLibrarianHandler({
    verifyUser: createIdentityVerifier({ identityUrl: process.env.LIBRARIAN_IDENTITY_URL || undefined }),
    github: token
      ? createGitHubCommunityStore({
          token,
          repo: process.env.LIBRARIAN_GITHUB_REPO || 'community-data-libraries/web',
          branch: process.env.LIBRARIAN_GITHUB_BRANCH || 'main',
        })
      : null,
    librarians: token
      ? createLibrarianStore(getStore({ name: LIBRARIAN_STORE_NAME, consistency: 'strong' }))
      : null,
  });
}

export default async (request) => getHandler()(request);

export const config = {
  path: ['/api/librarian/libraries', '/api/librarian/libraries/*'],
};
