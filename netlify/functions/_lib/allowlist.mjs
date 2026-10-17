export const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export function isAllowed(email, rawList = '') {
  const target = normalizeEmail(email);
  if (!target) return false;
  return rawList.split(',').map(normalizeEmail).includes(target);
}

export const isValidEmail = (email) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
