import { loadConfig } from './_lib/config.mjs';
import { HttpError, json, toResponse } from './_lib/http.mjs';
import { requireEditor } from './_lib/session.mjs';
import { readYaml, replaceTopLevelKeys } from './_lib/yamlEdit.mjs';
import { pickEditable, toTopLevelUpdates, validateChanges } from './_lib/editableFields.mjs';
import { createGitHub } from './_lib/github.mjs';

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
  return short.replace(/\|/g, '\\|').replace(/\n/g, ' ');
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
      const head = await github.getHeadSha();
      const { file, current, vocabulary } = await loadAt(github, head, id);
      const updates = toTopLevelUpdates(current, validateChanges(body.changes, vocabulary), vocabulary);
      if (Object.keys(updates).length === 0) throw new HttpError(400, 'Nothing changed');

      const branch = `${branchPrefix(id)}${timestamp(now())}`;
      await github.createBranch(branch, head);
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
      return toResponse(err);
    }
  };
}

export default async (request, context) => {
  const config = loadConfig();
  const github = createGitHub({ token: config.githubToken, repo: config.githubRepo });
  return createHandler({ config, github })(request, context);
};
