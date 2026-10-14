export function createGitHub({ token, repo, fetchImpl = fetch }) {
  async function api(method, path, body) {
    const res = await fetchImpl(`https://api.github.com/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28',
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 404 && method === 'GET') return null;
    if (!res.ok) throw new Error(`GitHub ${method} ${path} failed: HTTP ${res.status}`);
    return res.status === 204 ? {} : res.json();
  }

  return {
    async getHeadSha(branch = 'main') {
      const ref = await api('GET', `/git/ref/heads/${branch}`);
      if (!ref) throw new Error(`Branch ${branch} not found`);
      return ref.object.sha;
    },
    async getFile(path, ref) {
      const file = await api('GET', `/contents/${path}?ref=${ref}`);
      return file && { text: Buffer.from(file.content, 'base64').toString('utf8'), sha: file.sha };
    },
    createBranch: (name, sha) => api('POST', '/git/refs', { ref: `refs/heads/${name}`, sha }),
    deleteBranch: (name) => api('DELETE', `/git/refs/heads/${name}`),
    putFile: (path, { text, sha, branch, message }) =>
      api('PUT', `/contents/${path}`, { message, content: Buffer.from(text, 'utf8').toString('base64'), sha, branch }),
    openPullRequest: ({ title, body, head, base = 'main' }) => api('POST', '/pulls', { title, body, head, base }),
    async listOpenPullRequests(prefix) {
      const pulls = (await api('GET', '/pulls?state=open&per_page=100')) ?? [];
      return pulls.filter((p) => p.head.ref.startsWith(prefix)).map((p) => ({ number: p.number, url: p.html_url, title: p.title }));
    },
  };
}
