# Environment Variables

This guide covers every environment variable used by the Community Data Libraries (CDL) `web` site, its Netlify functions, and the `backend` repo. It is based on `web@main`.

**Where each variable goes:**

| Location | Where to set it | Variables |
|---|---|---|
| Netlify (production site) | Netlify → Site configuration → Environment variables | [Metadata editor](#metadata-editor-netlify), [Notifications](#notifications-netlify) |
| GitHub Actions secret (backend repo) | `community-data-libraries/backend` → Settings → Secrets and variables → Actions → **Repository secrets** | [`NETLIFY_BUILD_HOOK`](#netlify_build_hook) |
| Your computer (local development) | `web/.env`, or your shell | [Local development](#local-development-optional) |

> **Never commit secrets.** `.env` is git-ignored. Do not paste secret values into chat, issues, or pull requests. If one leaks, rotate it (see each entry below).

---

## Metadata editor (Netlify)

These variables power the magic-link sign-in that lets approved editors change dataset metadata on `/web/data-preview`. Each saved edit opens a pull request on the backend repo. The editor only works on the main Netlify site.

The functions refuse to start if `AUTH_SECRET`, `EDITOR_EMAILS`, or `SITE_ORIGIN` is missing.

### `AUTH_SECRET`
**Required · Secret**

The private key that signs sign-in tokens. It signs two things:

1. **The emailed sign-in link.** This contains the editor's email, a 15-minute expiry, and a one-time code.
2. **The session cookie** (`cdl_session`). This keeps an editor signed in for 7 days.

The server keeps no session database. A valid signature is how it knows a link or cookie is genuine and has not been changed.

- **Value:** a random string of at least 32 characters. Generate one with:
  ```bash
  openssl rand -base64 48
  ```
- **Risk if leaked:** anyone with it can create a valid session for any approved email, without access to that inbox.
- **Rotating:** changing it signs everyone out and makes any unused links stop working. Editors simply request a new link. Rotate it right away if you think it has leaked.
- Use a **different** value for local testing than for production.

### `EDITOR_EMAILS`
**Required**

A comma-separated list of the email addresses allowed to edit, for example:
```
alice@example.org, bob@example.org
```
- Matching ignores letter case and extra spaces.
- It is checked on **every** request, not only at sign-in. Removing an email takes away access immediately, even for someone who is already signed in.
- Requests from emails that are not on the list get the same "a link is on its way" reply as approved ones. This means the sign-in form does not reveal who is approved.

### `SITE_ORIGIN`
**Required**

The site's exact origin (scheme + host, with no path or trailing slash), for example `https://cdl.netlify.app`.

- Used to build the sign-in link that goes in the email.
- Used to reject requests coming from other websites. Sign-in, sign-out, and edits must come from this origin.
- Deploy previews have a different origin, so editing is disabled on them. This is intentional.
- Local testing with `netlify dev`: `http://localhost:8888`.

### `RESEND_API_KEY`
**Required for sign-in emails · Secret**

An API key from [resend.com](https://resend.com), the service that sends the sign-in emails. If it is missing or invalid, sign-in requests still return "a link is on its way", but no email arrives. The function logs show `auth-request-link: email failed`.

- **Rotating:** create a new key in Resend, update it in Netlify, then delete the old key.

### `MAIL_FROM`
**Required for sign-in emails**

The sender shown on sign-in emails, for example:
```
CDL Editors <editors@your-domain.org>
```
The domain must be verified in Resend, or emails will not send.

### `GITHUB_TOKEN`
**Required for saving edits · Secret**

A GitHub token the editor uses to create a branch, commit the change, and open a pull request on the backend repo.

- **Type:** a fine-grained personal access token.
- **Repository access:** only `community-data-libraries/backend` (or your test fork, see `GITHUB_REPO`).
- **Permissions:** Contents → Read and write; Pull requests → Read and write. Nothing else.
- **Expiry:** fine-grained tokens expire. When this one does, every edit shows "GitHub is unavailable" and nothing is saved. Put a reminder on the calendar to renew it.
- Pull requests are opened under the token owner's GitHub account. The commit message records which editor made the change.

### `GITHUB_REPO`
**Optional** · Default: `community-data-libraries/backend`

The repository (`owner/name`) where edit pull requests are opened. Point it at a fork when testing so you don't open real pull requests, for example `your-username/backend`. `GITHUB_TOKEN` must have access to whichever repo you choose.

---

## Notifications (Netlify)

### `SLACK_WEBHOOK_URL`
**Optional · Secret**

A Slack Incoming Webhook URL. When someone submits a resource through the site's submission form, a message is posted to that Slack channel. Leave it unset to turn this off.

Setup: create a Slack app at https://api.slack.com/apps → enable Incoming Webhooks → add it to the channel → copy the URL into Netlify.

---

## GitHub Actions secret (backend repo)

### `NETLIFY_BUILD_HOOK`
**Required for automatic rebuilds · Secret**

A Netlify build hook URL. The backend's `Rebuild website` workflow (`.github/workflows/netlify-rebuild.yml`) calls it whenever `data/**` changes on `main`. This is how merged metadata edits reach the live site.

- **Where:** a **repository** secret in `community-data-libraries/backend` (Settings → Secrets and variables → Actions → Repository secrets). It is **not** an environment secret. The workflow job does not name an environment, so it cannot read environment secrets.
- **Create the hook:** Netlify → Site configuration → Build & deploy → Build hooks.
- **If missing:** the workflow logs `NETLIFY_BUILD_HOOK secret is not set; skipping.` and still passes. The run looks green, but the site does not rebuild.
- **Test it:** Actions → Rebuild website → Run workflow, then confirm a new deploy appears in Netlify.
- **Risk if leaked:** anyone can trigger builds, which uses up build minutes. To rotate, delete the hook in Netlify, create a new one, and update the secret.

---

## Local development (optional)

None of these are needed on Netlify, where the build sets what it needs. The defaults work when `web/` and `backend/` sit side by side in the same folder.

| Variable | Used by | Default | Purpose |
|---|---|---|---|
| `BACKEND_ROOT` | web build scripts, backend | `../backend` | Path to the canonical backend repo. The Netlify build sets this itself. |
| `BACKEND_SOURCES_DIR` | web build scripts | `$BACKEND_ROOT/data/sources` | Overrides just the dataset YAML folder. |
| `PUBLIC_API_BASE_URL` | Astro site (browser) | empty (same origin) | Where the site fetches `/api/*` from. Development only (the deployed Data Preview page reads static files). Leave empty to use the dev proxy locally. Because of the `PUBLIC_` prefix, it is visible in the browser, so never put a secret here. |
| `BACKEND_DEV_URL` | `astro dev` proxy | `http://localhost:4323` | Where `npm run dev` forwards `/api/sources` and `/api/health`. |
| `BACKEND_PORT` | backend API server | `4323` | Port for `npm run backend:dev`. |
| `SOURCES_DB_PATH` | backend API server | built-in SQLite path | Use a different SQLite database. |
| `PREVIEW_ENGINE` | backend API server | pandas if available | Set to `node` to skip the Python/pandas preview engine. |
| `PANDAS_TIMEOUT_MS` | backend API server | `120000` | Time limit for a pandas data preview. |

### Testing the editor locally

1. `npm install -g netlify-cli`
2. Create `web/.env`:
   ```bash
   AUTH_SECRET=<run: openssl rand -base64 48>   # NOT the production value
   EDITOR_EMAILS=you@example.org
   SITE_ORIGIN=http://localhost:8888
   RESEND_API_KEY=<test key>
   MAIL_FROM=CDL Editors <editors@your-verified-domain.org>
   GITHUB_TOKEN=<token with access to your fork only>
   GITHUB_REPO=<your-username>/backend
   ```
3. Run `netlify dev` in `web/`, then open `http://localhost:8888/web/data-preview`.
4. Request a link, open it from your email, click **Sign in**, then save an edit. Confirm the pull request appears on your fork.

Unit tests need no variables: `npm run test:functions`.

---

## Quick troubleshooting

| Symptom | Check |
|---|---|
| Functions fail with `Missing environment variable …` | `AUTH_SECRET`, `EDITOR_EMAILS`, `SITE_ORIGIN` are all set; `AUTH_SECRET` is at least 32 characters |
| No sign-in email arrives | `RESEND_API_KEY`, `MAIL_FROM`, Resend domain verification, and the email address is in `EDITOR_EMAILS` |
| "Bad origin" or sign-in is disabled | `SITE_ORIGIN` exactly matches the address in the browser (no trailing slash); you're not on a deploy preview |
| "GitHub is unavailable" on every edit | `GITHUB_TOKEN` hasn't expired and has the right permissions; `GITHUB_REPO` is correct |
| Edit pull request merged, but the site didn't update | `NETLIFY_BUILD_HOOK` is a **repository** secret in the backend repo; check the Rebuild website workflow log |
| Everyone was signed out | `AUTH_SECRET` was changed (expected) |

More detail: [metadata-editor.md](metadata-editor.md).
