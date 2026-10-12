/**
 * Community library files stored in the GitHub repo, read and committed through
 * the GitHub contents API. Every write passes the file's current blob SHA (or none
 * for a new file), so GitHub rejects it if the file changed in the meantime.
 */

import {
  COMMUNITIES_DIR,
  communityPath,
  parseCommunityMarkdown,
  serializeCommunityMarkdown,
} from '../../src/lib/community/communityFile.mjs';

/** The file changed (or appeared) since it was read; the caller should reload. */
export class ConflictError extends Error {}

/**
 * @param {object} options
 * @param {string} options.token GitHub token with Contents read/write on the repo.
 * @param {string} options.repo "owner/name"
 * @param {string} [options.branch]
 * @param {typeof fetch} [options.fetch]
 */
export function createGitHubCommunityStore({ token, repo, branch = 'main', fetch = globalThis.fetch }) {
  const api = `https://api.github.com/repos/${repo}/contents`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'community-data-libraries-librarian-portal',
  };

  async function request(path, init = {}) {
    const response = await fetch(`${api}/${path}`, {
      ...init,
      headers: { ...headers, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    });
    if (response.status === 404) return null;
    if (response.status === 409 || response.status === 422) {
      throw new ConflictError(`GitHub rejected the write to ${path} (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
    }
    return response.json();
  }

  async function readFile(path) {
    const file = await request(`${path}?ref=${encodeURIComponent(branch)}`);
    if (!file) return null;
    const markdown = Buffer.from(file.content, 'base64').toString('utf8');
    const { data, body } = parseCommunityMarkdown(markdown);
    return { community: data, body, sha: file.sha };
  }

  async function writeFile(community, body, message, sha) {
    const content = Buffer.from(serializeCommunityMarkdown(community, body), 'utf8').toString('base64');
    await request(communityPath(community.slug), {
      method: 'PUT',
      body: JSON.stringify({ message, content, branch, ...(sha ? { sha } : {}) }),
    });
  }

  return {
    async list() {
      const entries = (await request(`${COMMUNITIES_DIR}?ref=${encodeURIComponent(branch)}`)) ?? [];
      const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'));
      return Promise.all(files.map((entry) => readFile(entry.path)));
    },

    get(slug) {
      return readFile(communityPath(slug));
    },

    /** Fails with ConflictError if a file with this slug already exists. */
    create(community, message) {
      return writeFile(community, '', message);
    },

    update(community, body, sha, message) {
      return writeFile(community, body, message, sha);
    },
  };
}
