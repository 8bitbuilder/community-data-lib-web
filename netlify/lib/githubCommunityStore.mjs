/**
 * Community library files stored in the GitHub repo, read and committed through
 * the GitHub REST API. Every write passes the file's current blob SHA (or none for
 * a new file), so GitHub rejects it if the file changed in the meantime.
 *
 * New libraries are proposed as pull requests (branch library/<slug>) so the team
 * approves them by merging; edits to approved libraries commit to the main branch.
 */

import {
  COMMUNITIES_DIR,
  communityPath,
  parseCommunityMarkdown,
  serializeCommunityMarkdown,
} from '../../src/lib/community/communityFile.mjs';

/** The file or branch changed (or appeared) since it was read; the caller should reload. */
export class ConflictError extends Error {}

/**
 * @param {object} options
 * @param {string} options.token GitHub token with Contents and Pull requests read/write on the repo.
 * @param {string} options.repo "owner/name"
 * @param {string} [options.branch] Branch the site deploys from.
 * @param {typeof fetch} [options.fetch]
 */
export function createGitHubCommunityStore({ token, repo, branch = 'main', fetch = globalThis.fetch }) {
  const api = `https://api.github.com/repos/${repo}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'community-data-libraries-librarian-portal',
  };

  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${api}/${path}`, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 404) return null;
    if (response.status === 409 || response.status === 422) {
      throw new ConflictError(`GitHub rejected ${method} ${path} (${response.status})`);
    }
    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${method} ${path}: ${await response.text()}`);
    }
    return response.json();
  }

  async function readFile(path, ref = branch) {
    const file = await request(`contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (!file) return null;
    const markdown = Buffer.from(file.content, 'base64').toString('utf8');
    const { data, body } = parseCommunityMarkdown(markdown);
    return { community: data, body, sha: file.sha };
  }

  function writeFile(community, body, message, { sha, ref = branch } = {}) {
    const content = Buffer.from(serializeCommunityMarkdown(community, body), 'utf8').toString('base64');
    return request(`contents/${communityPath(community.slug)}`, {
      method: 'PUT',
      body: { message, content, branch: ref, ...(sha ? { sha } : {}) },
    });
  }

  return {
    /** Libraries live on the main branch. */
    async list() {
      const entries = (await request(`contents/${COMMUNITIES_DIR}?ref=${encodeURIComponent(branch)}`)) ?? [];
      const files = entries.filter((entry) => entry.type === 'file' && entry.name.endsWith('.md'));
      return (await Promise.all(files.map((entry) => readFile(entry.path)))).filter(Boolean);
    },

    get(slug) {
      return readFile(communityPath(slug));
    },

    /** Commit an edit to a live library. */
    update(community, body, sha, message) {
      return writeFile(community, body, message, { sha });
    },

    /**
     * Propose a new library: branch library/<slug> off the main branch, add its
     * file there, and open a pull request. Fails with ConflictError if the branch
     * or file already exists. Returns { number, url }.
     */
    async proposeNew(community, { message, title, body }) {
      const path = communityPath(community.slug);
      const proposal = `library/${community.slug}`;
      const base = await request(`git/ref/heads/${encodeURIComponent(branch)}`);
      if (!base) throw new Error(`Branch ${branch} not found in ${repo}`);
      await request('git/refs', { method: 'POST', body: { ref: `refs/heads/${proposal}`, sha: base.object.sha } });
      await writeFile(community, '', message, { ref: proposal });
      const pull = await request('pulls', {
        method: 'POST',
        body: { title, head: proposal, base: branch, body, maintainer_can_modify: true },
      });
      if (!pull) throw new Error(`Could not open a pull request for ${path}`);
      return { number: pull.number, url: pull.html_url };
    },

    /** { state: 'open' | 'closed', merged: boolean } or null. */
    async getPullRequest(number) {
      const pull = await request(`pulls/${Number(number)}`);
      return pull ? { state: pull.state, merged: Boolean(pull.merged) } : null;
    },
  };
}
