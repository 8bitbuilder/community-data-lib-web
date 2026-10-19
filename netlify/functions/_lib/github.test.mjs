import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGitHub, GitHubError } from './github.mjs';

test('GitHubError extends Error and includes status', () => {
  const err = new GitHubError('test error', 404);
  assert.ok(err instanceof Error);
  assert.ok(err instanceof GitHubError);
  assert.equal(err.status, 404);
  assert.equal(err.message, 'test error');
  assert.equal(err.name, 'GitHubError');
});

test('getFile returns null on 404', async () => {
  const mockFetch = async (url, opts) => {
    return { status: 404, ok: false };
  };
  const github = createGitHub({ token: 'test-token', repo: 'test/repo', fetchImpl: mockFetch });
  const result = await github.getFile('data/sources/x.yml', 'abc');
  assert.equal(result, null);
});

test('getFile decodes base64 content with embedded newlines', async () => {
  const content = 'line1\nline2\nline3';
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  const mockFetch = async (url, opts) => {
    return {
      status: 200,
      ok: true,
      json: async () => ({ content: encoded, sha: 'abc123' }),
    };
  };
  const github = createGitHub({ token: 'test-token', repo: 'test/repo', fetchImpl: mockFetch });
  const result = await github.getFile('data/sources/test.yml', 'main');
  assert.equal(result.text, content);
  assert.equal(result.sha, 'abc123');
});

test('getFile requests correct path with ref query parameter', async () => {
  let capturedUrl = '';
  const mockFetch = async (url, opts) => {
    capturedUrl = url;
    return {
      status: 200,
      ok: true,
      json: async () => ({ content: Buffer.from('', 'utf8').toString('base64'), sha: 'abc' }),
    };
  };
  const github = createGitHub({ token: 'test-token', repo: 'test/repo', fetchImpl: mockFetch });
  await github.getFile('data/sources/x.yml', 'abc');
  assert.ok(capturedUrl.includes('/contents/data/sources/x.yml?ref=abc'));
});

test('deleteBranch resolves on 204', async () => {
  const mockFetch = async (url, opts) => {
    return { status: 204, ok: true };
  };
  const github = createGitHub({ token: 'test-token', repo: 'test/repo', fetchImpl: mockFetch });
  const result = await github.deleteBranch('test-branch');
  assert.deepEqual(result, {});
});

test('500 response throws GitHubError with status', async () => {
  const mockFetch = async (url, opts) => {
    return { status: 500, ok: false };
  };
  const github = createGitHub({ token: 'test-token', repo: 'test/repo', fetchImpl: mockFetch });
  try {
    await github.getHeadSha('main');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof GitHubError);
    assert.equal(err.status, 500);
  }
});

test('listOpenPullRequests with a RegExp matches only exact metadata branches', async () => {
  const pull = (n, ref) => ({ number: n, html_url: `u${n}`, title: `t${n}`, head: { ref } });
  const mockFetch = async () => ({
    status: 200,
    ok: true,
    json: async () => [
      pull(1, 'metadata/usda-milk-20261014T153000Z'),
      pull(2, 'metadata/usda-milk-2025-20261014T153000Z'),
    ],
    text: async () => '',
  });
  const github = createGitHub({ token: 't', repo: 'o/r', fetchImpl: mockFetch });
  const out = await github.listOpenPullRequests(/^metadata\/usda-milk-\d{8}T\d{6}Z$/);
  assert.deepEqual(out, [{ number: 1, url: 'u1', title: 't1' }]);
});
