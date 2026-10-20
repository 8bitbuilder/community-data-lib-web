/**
 * "Contact the librarian" messages (served by netlify/functions/library-contact.mjs).
 *
 * Visitors never see a librarian's email: the form posts here, this looks the
 * librarians up in the private Blobs store, and forwards the message by email with
 * the visitor's address as Reply-To.
 *
 *   POST /api/library-contact  { slug, name, email, message, website, started_at }
 *
 * `website` is a honeypot field humans never fill in; `started_at` is when the form
 * was shown, and instant submissions are treated as bots. Both get a quiet 200.
 */

import { isValidEmail, normalizeEmail, SLUG_PATTERN } from '../../src/lib/community/librarianRules.mjs';

const MAX_BODY_BYTES = 10_000;
const MIN_FILL_MS = 3_000;
export const CONTACT_LIMITS = { name: 100, message: 3000, minMessage: 10 };

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const fail = (status, message) => json(status, { error: message });

/** Problems with a contact submission, as a list of messages. */
export function validateContact({ name, email, message }) {
  const errors = [];
  const trimmedName = String(name ?? '').trim();
  const trimmedMessage = String(message ?? '').trim();
  if (!trimmedName || trimmedName.length > CONTACT_LIMITS.name) errors.push('Enter your name (up to 100 characters).');
  if (!isValidEmail(email)) errors.push('Enter a valid email address so the librarian can reply.');
  if (trimmedMessage.length < CONTACT_LIMITS.minMessage || trimmedMessage.length > CONTACT_LIMITS.message) {
    errors.push('Write a message between 10 and 3,000 characters.');
  }
  return errors;
}

/**
 * Sends email through Resend's HTTP API (https://resend.com/docs/api-reference/emails/send-email).
 * @returns {(email: { to: string[], replyTo: string, subject: string, text: string }) => Promise<void>}
 */
export function createResendSender({ apiKey, from, fetch = globalThis.fetch }) {
  return async ({ to, replyTo, subject, text }) => {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, reply_to: replyTo, subject, text }),
    });
    if (!response.ok) throw new Error(`Resend ${response.status}: ${await response.text()}`);
  };
}

/**
 * @param {object} deps
 * @param {{ get: (slug: string) => Promise<object | null> } | null} deps.librarians Private librarian records.
 * @param {((email: object) => Promise<void>) | null} deps.send null when email isn't configured.
 * @param {((slug: string) => Promise<unknown>) | null} [deps.isLive] Whether the library is on the site;
 *   lets a just-merged library receive mail before its record is marked approved.
 * @param {() => number} [deps.now]
 */
export function createContactHandler({ librarians, send, isLive = null, now = Date.now }) {
  return async function handle(request) {
    if (request.method !== 'POST') return fail(405, 'Method not allowed');
    if (!librarians || !send) return fail(503, 'The contact form is not set up on this site yet.');

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return fail(413, 'Message is too long.');
    let input;
    try {
      input = JSON.parse(raw);
    } catch {
      return fail(400, 'Send the message as JSON.');
    }
    if (!input || typeof input !== 'object') return fail(400, 'Send the message as JSON.');

    // Bots: pretend it worked so they don't retry.
    const startedAt = Number(input.started_at);
    if (String(input.website ?? '').trim() || !startedAt || now() - startedAt < MIN_FILL_MS) {
      return json(200, { ok: true });
    }

    const errors = validateContact(input);
    if (errors.length > 0) return json(400, { error: errors.join(' '), errors });

    const slug = String(input.slug ?? '');
    const record = SLUG_PATTERN.test(slug) ? await librarians.get(slug).catch(() => null) : null;
    const reachable =
      record?.emails?.length > 0 &&
      (record.status === 'approved' || (record.status === 'pending' && isLive && (await isLive(slug).catch(() => null))));
    if (!reachable) return fail(404, 'This library isn’t receiving messages yet.');

    const name = String(input.name).trim();
    const email = normalizeEmail(input.email);
    try {
      await send({
        to: record.emails,
        replyTo: email,
        subject: `Message for ${record.name} from the Community Data Libraries site`,
        text: [
          `${name} <${email}> sent a message through the contact form for ${record.name}:`,
          '',
          String(input.message).trim(),
          '',
          '---',
          'Reply to this email to answer them directly. You received this because you are a librarian',
          'for this library; manage librarians in the librarian portal.',
        ].join('\n'),
      });
    } catch (err) {
      console.error('library-contact error:', err);
      return fail(502, 'Your message could not be sent. Please try again later.');
    }
    return json(200, { ok: true });
  };
}
