import { loadConfig } from './_lib/config.mjs';
import { HttpError, json, toResponse } from './_lib/http.mjs';
import { requireEditor } from './_lib/session.mjs';
import { readYaml, replaceTopLevelKeys } from './_lib/yamlEdit.mjs';
import { pickEditable, toTopLevelUpdates, validateChanges } from './_lib/editableFields.mjs';
import { createGitHub, GitHubError } from './_lib/github.mjs';

const VOCABULARY_PATH = 'data/tag_vocabulary.yml';
const sourcePath = (id) => `data/sources/${id}.yml`;
const branchPrefix = (id) => `metadata/${id}-`;

function checkId(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new HttpError(400, 'Invalid dataset id', 'id');
  return id;
}

async function loadAt(github, ref, id) {
  const [file, vocabFile] = await Promise.all([github.getFile(sourcePath(id), ref), github.getFile(VOCABULARY_PATH, ref)]);
  if (!file) throw new HttpError(404, `Dataset ${id} not found`);
  if (!vocabFile) throw new Error(`${VOCABULARY_PATH} missing on ${ref}`);
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

export function createHandler({ config, github, now = Date.now }) {
  return async (request) => {
    try {
      const email = requireEditor(request, config, now());

      if (request.method === 'GET') {
        const id = checkId(new URL(request.url).searchParams.get('id'));
        const head = await github.getHeadSha();
        const { current, vocabulary } = await loadAt(github, head, id);
        return json(200, {
          id,
          fields: pickEditable(current, vocabulary),
          manualTags: Array.isArray(current.manual_tags) ? current.manual_tags : [],
          vocabulary,
          openPullRequests: await github.listOpenPullRequests(branchPrefix(id)),
        });
      }

      if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed');
      const body = await request.json().catch(() => {
        throw new HttpError(400, 'Invalid JSON');
      });
      const id = checkId(body?.id);
      const fields = body?.changes && typeof body.changes === 'object' ? Object.keys(body.changes) : [];

      try {
        const head = await github.getHeadSha();
        const { file, current, vocabulary } = await loadAt(github, head, id);
        const changes = validateChanges(body.changes, vocabulary);
        const updates = toTopLevelUpdates(current, changes, vocabulary);
        if (Object.keys(updates).length === 0) throw new HttpError(400, 'Nothing changed');

        const branch = `${branchPrefix(id)}${timestamp(now())}`;
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
          console.log(`metadata-edit: ${email} edited ${id} [${Object.keys(updates).join(', ')}] -> PR #${pr.number}`);
          return json(201, { prUrl: pr.html_url, prNumber: pr.number });
        } catch (err) {
          console.error(`metadata-edit: ${email} edit of ${id} failed:`, err.message);
          await github.deleteBranch(branch).catch(() => {});
          throw new HttpError(502, 'Could not open a pull request, so nothing was saved. Please try again.');
        }
      } catch (err) {
        // Log POST failures: GitHub errors, validation errors, no-ops
        if (err instanceof HttpError && [400, 404, 409, 502].includes(err.status)) {
          const fieldsStr = fields.length > 0 ? ` [${fields.join(', ')}]` : '';
          console.log(`metadata-edit: ${email} post ${id}${fieldsStr} ${err.status}`);
        } else if (err instanceof GitHubError) {
          const fieldsStr = fields.length > 0 ? ` [${fields.join(', ')}]` : '';
          console.log(`metadata-edit: ${email} post ${id}${fieldsStr} 502`);
        }
        throw err;
      }
    } catch (err) {
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
