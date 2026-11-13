/**
 * Browser side of the librarian portal: Netlify Identity sessions and calls to the
 * librarian API (netlify/functions/librarian-api.mjs).
 *
 * This is the only module that imports @netlify/identity, and only /librarian/
 * pages import it, so public pages never load Identity code. Logging in sets the
 * nf_jwt cookie that the librarian function reads.
 */

import { getSettings, getUser, logout, type User } from '@netlify/identity';
import { libraryHref, withBasePath } from '@lib/paths';
import { safeNext } from './portal';

export const API = '/api/librarian/libraries';

export const pages = {
  dashboard: withBasePath('/librarian/'),
  login: withBasePath('/librarian/login/'),
  register: withBasePath('/librarian/register/'),
  edit: (slug: string) => withBasePath(`/librarian/${encodeURIComponent(slug)}/edit/`),
  community: (slug: string) => libraryHref(slug),
};

export const nextPage = (next: string | null) => safeNext(next, pages.dashboard);

/** Whether this copy of the site has Netlify Identity (not localhost or a static preview). */
export async function identityAvailable(): Promise<boolean> {
  try {
    await getSettings();
    return true;
  } catch {
    return false;
  }
}

export function showStatus(message: string, kind: 'info' | 'error' = 'info') {
  const status = document.getElementById('portal-status');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', kind === 'error');
  status.hidden = !message;
}

function setupNav(user: User) {
  const nav = document.getElementById('portal-nav');
  if (!nav) return;
  nav.hidden = false;
  const email = document.getElementById('nav-email');
  if (email) email.textContent = user.email ?? '';
  document.getElementById('logout-btn')?.addEventListener('click', async () => {
    await logout().catch(() => {});
    location.href = pages.login;
  });
}

/**
 * The logged-in user, or null after sending them to the login page (which comes
 * back here). Shows a note instead when Identity is not available.
 */
export async function requireUser(): Promise<User | null> {
  const user = await getUser().catch(() => null);
  if (user) {
    setupNav(user);
    return user;
  }
  if (!(await identityAvailable())) {
    showStatus(
      'Logging in only works on the deployed site (Netlify Identity is not available on this copy, e.g. localhost).',
      'error'
    );
    return null;
  }
  location.href = `${pages.login}?next=${encodeURIComponent(location.pathname + location.search)}`;
  return null;
}

export interface FieldError {
  field: string | null;
  message: string;
  existing?: { slug: string; name: string; pending: boolean };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly errors: FieldError[]
  ) {
    super(message);
  }
}

/** Call the librarian API with the login cookie; throws ApiError on a non-2xx answer. */
export async function api(path = '', { method = 'GET', body }: { method?: string; body?: unknown } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      response.status === 404 && !data.error
        ? 'The librarian service is not running on this copy of the site.'
        : (data.error ?? `Request failed (HTTP ${response.status}).`);
    throw new ApiError(response.status, message, data.errors ?? []);
  }
  return data;
}

/** Put each error under its field (elements with data-error-for), the rest in .form-error. */
export function showFieldErrors(form: HTMLFormElement, errors: FieldError[], fallback = '') {
  form.querySelectorAll<HTMLElement>('[data-error-for]').forEach((el) => (el.textContent = ''));
  const general: string[] = [];
  for (const error of errors) {
    const slot = error.field ? form.querySelector<HTMLElement>(`[data-error-for="${error.field}"]`) : null;
    if (slot) slot.textContent = error.message;
    else general.push(error.message);
  }
  const formError = form.querySelector<HTMLElement>('.form-error');
  if (formError) formError.textContent = general.join(' ') || (errors.length ? '' : fallback);
}

/** Text for a rebuild result returned by the API after a save. */
export function rebuildMessage(rebuild: string | undefined): string {
  if (rebuild === 'triggered') return 'The site is rebuilding; the public page updates in a few minutes.';
  if (rebuild === 'skipped') return 'The automatic rebuild is not set up, so the public page updates after the next deploy.';
  if (rebuild === 'failed') return 'Saved, but the site rebuild could not be started; it will update after the next deploy.';
  return '';
}
