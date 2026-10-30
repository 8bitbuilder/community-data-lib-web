import { loadConfig } from './_lib/config.mjs';
import { HttpError, json, toResponse } from './_lib/http.mjs';
import { requireEditor } from './_lib/session.mjs';
import { readYaml, replaceTopLevelKeys } from './_lib/yamlEdit.mjs';
import { pickEditable, toTopLevelUpdates, validateChanges } from './_lib/editableFields.mjs';
import { createGitHub, GitHubError } from './_lib/github.mjs';

const VOCABULARY_PATH = 'data/tag_vocabulary.yml';
const sourcePath = (id) => `data/sources/${id}.yml`;
const branchPrefix = (id) => `metadata/${id}-`;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const branchPattern = (id) => new RegExp(`^metadata/${escapeRe(id)}-\\d{8}T\\d{6}Z$`);

function checkId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new HttpError(400, 'Invalid dataset id', 'id');
  return id;
}

async function loadAt(github, ref, id) {
  const [file, vocabFile] = await Promise.all([github.getFile(sourcePath(id), ref), github.getFile(VOCABULARY_PATH, ref)]);
  if (!file) throw new HttpError(404, `Dataset ${id} not found`);
  if (!vocabFile) throw new HttpError(
      503,
      'The tag vocabulary has not been published to the backend repository yet. Ask an administrator to merge the backend changes first.',
    );
  const vocab = readYaml(vocabFile.text);
  const vocabulary = { description_tags: vocab.description_tags ?? [], statistical_tags: vocab.statistical_tags ?? {} };
  return { file, current: readYaml(file.text) ?? {}, vocabulary };
}

const cell = (v) => {
  const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
  const short = s.length > 300 ? `${s.slice(0, 297)}...` : s;
  return short.replace(/\|/g, '\\|').replace(/\r\n|\r|\n/g, ' ');
};

function prBody(id, email, current, updates) {
  const rows = Object.keys(updates).map((f) => `| \`${f}\` | ${cell(current[f])} | ${cell(updates[f])} |`);
  return [
    `Metadata edit for \`${id}\` submitted by ${email} via the Data Preview editor.`,
    '',
    '| Field | Before | After |',
    '|---|---|---|',
    ...rows,
  ].join('\n');
}

const timestamp = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');

function logAttempt(attempt) {
  const idStr = attempt.id || '-';
  const fieldsStr = attempt.fields.length > 0 ? ` [${attempt.fields.join(', ')}]` : '';
  const statusStr = attempt.status || '?';
  const prStr = attempt.pr ? ` PR #${attempt.pr}` : '';
  const reasonStr = attempt.reason ? ` (${attempt.reason})` : '';
  const logLine = `metadata-edit: ${attempt.email || '-'} ${idStr}${fieldsStr} -> ${statusStr}${prStr}${reasonStr}`;

  if (attempt.status >= 200 && attempt.status < 300) {
    console.log(logLine);
  } else {
    console.error(logLine);
  }
}

async function handlePost(request, config, github, now) {
  const attempt = { email: null, id: null, fields: [], status: null, pr: null, reason: null };
  let response = null;
  let body = null;
  let id = null;
  let branch = null;
  let email = null;

  try {
    // Authenticate within POST handler so auth failures are logged
    email = requireEditor(request, config, now());
    attempt.email = email;

    body = await request.json().catch(() => {
      throw new HttpError(400, 'Invalid JSON');
    });

    attempt.id = String(body?.id ?? '').slice(0, 100);

    // Extract fields early if present
    if (body?.changes && typeof body.changes === 'object' && !Array.isArray(body.changes)) {
      attempt.fields = Object.keys(body.changes).slice(0, 30).map((k) => k.slice(0, 50));
    }

    id = checkId(body?.id);
    const head = await github.getHeadSha();
    const { file, current, vocabulary } = await loadAt(github, head, id);
    const changes = validateChanges(body.changes, vocabulary);
    const updates = toTopLevelUpdates(current, changes, vocabulary);
    if (Object.keys(updates).length === 0) throw new HttpError(400, 'Nothing changed');

    branch = `${branchPrefix(id)}${timestamp(now())}`;
    try {
      await github.createBranch(branch, head);
    } catch (err) {
      if (err instanceof GitHubError && err.status === 422) {
        throw new HttpError(409, 'Another edit to this dataset was just submitted. Please try again in a moment.');
      }
      throw err;
    }

    try {
      await github.putFile(sourcePath(id), {
        text: replaceTopLevelKeys(file.text, updates),
        sha: file.sha,
        branch,
        message: `Update metadata for ${id}\n\nCo-Authored-By: ${email} <${email}>`,
      });
      const pr = await github.openPullRequest({
        title: `Update metadata: ${current.title ?? id} (by ${email})`,
        body: prBody(id, email, current, updates),
        head: branch,
      });
      attempt.pr = pr.number;
      attempt.status = 201;
      response = json(201, { prUrl: pr.html_url, prNumber: pr.number });
    } catch (err) {
      // putFile/openPullRequest failures must delete the branch and return 502
      await github.deleteBranch(branch).catch(() => {});
      throw new HttpError(502, 'Could not open a pull request, so nothing was saved. Please try again.');
    }
  } catch (err) {
    // Handle all errors: set attempt status and reason, construct response
    if (err instanceof HttpError) {
      attempt.status = err.status;
      attempt.reason = err.message;
      response = json(err.status, { error: err.message, ...(err.field ? { field: err.field } : {}) });
    } else if (err instanceof GitHubError) {
      attempt.status = 502;
      attempt.reason = err.message;
      response = json(502, { error: 'GitHub is unavailable right now, so nothing was saved. Please try again.' });
    } else {
      attempt.status = 500;
      attempt.reason = 'unexpected error';
      response = json(500, { error: 'Internal error' });
    }
  } finally {
    logAttempt(attempt);
  }

  return response;
}

export function createHandler({ config, github, now = Date.now }) {
  return async (request) => {
    try {
      // Check method first to handle POST auth failures with logging
      if (request.method === 'POST') {
        // Handle POST with its own tracking (including auth)
        return await handlePost(request, config, github, now);
      }

      if (request.method === 'GET') {
        const email = requireEditor(request, config, now());
        const id = checkId(new URL(request.url).searchParams.get('id'));
        const head = await github.getHeadSha();
        const { current, vocabulary } = await loadAt(github, head, id);
        return json(200, {
          id,
          fields: pickEditable(current, vocabulary),
          manualTags: Array.isArray(current.manual_tags) ? current.manual_tags : [],
          vocabulary,
          openPullRequests: await github.listOpenPullRequests(branchPattern(id)),
        });
      }

      throw new HttpError(405, 'Method not allowed');
    } catch (err) {
      // Outer errors (GET failures, method not allowed, GET auth failures)
      // Convert GitHubError at outer level to 502
      if (err instanceof GitHubError) {
        return toResponse(new HttpError(502, 'GitHub is unavailable right now, so nothing was saved. Please try again.'));
      }
      return toResponse(err);
    }
  };
}

export default async (request, context) => {
  const config = loadConfig();
  const github = createGitHub({ token: config.githubToken, repo: config.githubRepo });
  return createHandler({ config, github })(request, context);
};
