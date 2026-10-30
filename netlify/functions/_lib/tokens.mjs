import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const encode = (value) => Buffer.from(value).toString('base64url');
const hmac = (body, secret) => createHmac('sha256', secret).update(body).digest();

export function signToken(payload, secret) {
  const body = encode(JSON.stringify(payload));
  return `${body}.${encode(hmac(body, secret))}`;
}

export function verifyToken(token, secret, { purpose, now = Date.now() }) {
  if (typeof token !== 'string') return { error: 'invalid' };
  const parts = token.split('.');
  if (parts.length !== 2) return { error: 'invalid' };
  const [body, sig] = parts;
  const expected = hmac(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { error: 'invalid' };
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { error: 'invalid' };
  }
  if (!payload || payload.purpose !== purpose || typeof payload.email !== 'string') return { error: 'invalid' };
  if (typeof payload.exp !== 'number' || payload.exp <= now) return { error: 'expired' };
  return { payload };
}

export const newNonce = () => randomBytes(16).toString('base64url');
