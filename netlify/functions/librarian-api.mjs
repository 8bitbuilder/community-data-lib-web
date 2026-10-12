/**
 * Netlify Function: librarian portal API (/api/librarian/*).
 *
 * Lets community librarians register and edit their community library files
 * (src/content/communities/*.md). Logins come from Netlify Identity; saves are
 * committed to GitHub with a token from the environment, which triggers a rebuild.
 *
 * Environment variables (Netlify > Site configuration > Environment variables,
 * scoped to Functions):
 *   LIBRARIAN_GITHUB_TOKEN   Fine-grained token with Contents read/write on the repo (required)
 *   LIBRARIAN_GITHUB_REPO    "owner/name" (default community-data-libraries/web)
 *   LIBRARIAN_GITHUB_BRANCH  Branch the site deploys from (default main)
 */

import { createGitHubCommunityStore } from '../lib/githubCommunityStore.mjs';
import { createIdentityVerifier } from '../lib/identity.mjs';
import { createLibrarianHandler } from '../lib/librarianApi.mjs';

const token = process.env.LIBRARIAN_GITHUB_TOKEN;

const handle = createLibrarianHandler({
  verifyUser: createIdentityVerifier(),
  store: token
    ? createGitHubCommunityStore({
        token,
        repo: process.env.LIBRARIAN_GITHUB_REPO || 'community-data-libraries/web',
        branch: process.env.LIBRARIAN_GITHUB_BRANCH || 'main',
      })
    : null,
});

export default async (request) => handle(request);

export const config = {
  path: ['/api/librarian/libraries', '/api/librarian/libraries/*'],
};
