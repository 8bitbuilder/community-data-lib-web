import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const { handler } = createRequire(import.meta.url)('./submission-notify.cjs');

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.SLACK_WEBHOOK_URL;
});

function submission(data) {
  return { body: JSON.stringify({ payload: { data: { title: 'Knox water quality', ...data } } }) };
}

/** Run the handler with a Slack webhook set; return the response and the Slack message text. */
async function withSlack(data) {
  process.env.SLACK_WEBHOOK_URL = 'https://hooks.slack.test/x';
  let sent;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true };
  };
  const response = await handler(submission(data));
  return { response, text: JSON.stringify(sent.blocks) };
}

test('a state-level or smaller answer is accepted', async () => {
  const response = await handler(submission({ geography_level: 'county' }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).geographyOk, true);
});

test('national-only and missing answers are flagged for review', async () => {
  for (const geography_level of ['nation', undefined]) {
    const response = await handler(submission({ geography_level }));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).geographyOk, false);
  }
});

test('the Slack message shows the geography and warns when it does not qualify', async () => {
  const ok = await withSlack({ geography_level: 'zip', geography_variable: 'zip_code' });
  assert.match(ok.text, /Smallest geography:\*\\nZIP code \(column: zip_code\)/);
  assert.doesNotMatch(ok.text, /state-or-smaller rule/);

  const national = await withSlack({ geography_level: 'nation' });
  assert.match(national.text, /National totals only/);
  assert.match(national.text, /doesn't meet the state-or-smaller rule/);
});

test('invalid JSON is rejected', async () => {
  assert.equal((await handler({ body: '{' })).statusCode, 400);
});
