import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createContactHandler, createResendSender } from '../netlify/lib/libraryContact.mjs';
import contactFunction, { config } from '../netlify/functions/library-contact.mjs';

const NOW = 1_800_000_000_000;
// Library records as netlify/lib/communityDb.mjs returns them.
const libraries: Record<string, { name: string; approved: boolean; editors: string[] }> = {
  'knox-county': { name: 'Knox County Data Library', approved: true, editors: ['librarian@knoxdata.org', 'helper@knoxdata.org'] },
  pending: { name: 'Pending Library', approved: false, editors: ['p@x.org'] },
  orphan: { name: 'No Editors', approved: true, editors: [] },
};

function setup() {
  const sent: { to: string[]; replyTo: string; subject: string; text: string }[] = [];
  const handle = createContactHandler({
    libraries: { get: async (slug: string) => libraries[slug] ?? null },
    send: async (email) => {
      sent.push(email);
    },
    now: () => NOW,
  });
  return { sent, handle };
}

const message = {
  slug: 'knox-county',
  name: 'Pat Teacher',
  email: 'Pat@School.edu',
  message: 'Could my class use the population data for a project?',
  website: '',
  started_at: NOW - 60_000,
};

const post = (handle: (r: Request) => Promise<Response>, body: unknown) =>
  handle(new Request('https://cdl.example/api/library-contact', { method: 'POST', body: JSON.stringify(body) }));

test('a message is forwarded to the library editors with the visitor as reply-to', async () => {
  const { handle, sent } = setup();
  const res = await post(handle, message);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].to, ['librarian@knoxdata.org', 'helper@knoxdata.org']);
  assert.equal(sent[0].replyTo, 'pat@school.edu');
  assert.match(sent[0].subject, /Knox County Data Library/);
  assert.match(sent[0].text, /population data/);
  assert.doesNotMatch(await res.text(), /knoxdata/, 'editor emails never reach the visitor');
});

test('bots (honeypot filled or instant submit) get a quiet success and nothing is sent', async () => {
  const { handle, sent } = setup();
  assert.equal((await post(handle, { ...message, website: 'spam.example' })).status, 200);
  assert.equal((await post(handle, { ...message, started_at: NOW - 500 })).status, 200);
  assert.equal((await post(handle, { ...message, started_at: undefined })).status, 200);
  assert.equal(sent.length, 0);
});

test('invalid messages are rejected with reasons', async () => {
  const { handle, sent } = setup();
  const res = await post(handle, { ...message, name: '', email: 'nope', message: 'hi' });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).errors.length, 3);
  assert.equal(sent.length, 0);
});

test('only approved libraries with editors receive messages', async () => {
  const { handle, sent } = setup();
  for (const slug of ['missing', 'pending', 'orphan', '../etc']) {
    assert.equal((await post(handle, { ...message, slug })).status, 404, slug);
  }
  assert.equal(sent.length, 0);
});

test('without Resend or a database configured the function reports it is not set up', async () => {
  assert.equal(config.path, '/api/library-contact');
  const res = await contactFunction(
    new Request('https://cdl.example/api/library-contact', { method: 'POST', body: JSON.stringify(message) }),
  );
  assert.equal(res.status, 503);
});

test('the Resend sender posts the email', async () => {
  let call: { url: string; init: RequestInit } | undefined;
  const send = createResendSender({
    apiKey: 'key',
    from: 'CDL <librarians@example.org>',
    fetch: (async (url: string, init: RequestInit) => {
      call = { url, init };
      return Response.json({ id: '1' });
    }) as typeof fetch,
  });
  await send({ to: ['a@b.org'], replyTo: 'c@d.org', subject: 'Hi', text: 'Body' });
  assert.equal(call?.url, 'https://api.resend.com/emails');
  assert.equal((call?.init.headers as Record<string, string>).Authorization, 'Bearer key');
  assert.deepEqual(JSON.parse(String(call?.init.body)), {
    from: 'CDL <librarians@example.org>',
    to: ['a@b.org'],
    reply_to: 'c@d.org',
    subject: 'Hi',
    text: 'Body',
  });
});
