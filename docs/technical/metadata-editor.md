# Metadata editor (magic-link sign-in)

Approved editors can sign in on `/web/data-preview` and submit dataset-metadata edits.
Each edit opens a pull request on `community-data-libraries/backend`; merging it rebuilds the
Netlify site. Works on the Netlify deployment only.

Sign-in links open a confirm page, and the "Sign in" button completes sign-in (this protects
single-use links from email scanners). The sign-in control shows on `/web/data-preview` even when
no dataset is selected. If GitHub is unavailable, the editor shows a "try again" message and nothing
is saved.

Design: `backend/docs/superpowers/specs/2026-10-14-metadata-editor-auth-design.md`.

The Netlify build clones `community-data-libraries/backend@main` and syncs its data, so merged
edits appear on the next build. This also keeps the Data Preview API
(`netlify/functions/preview-api.mjs`, served from the synced backend export) current.

## Netlify environment variables

| Variable | Value |
|---|---|
| `EDITOR_EMAILS` | Comma-separated approved emails. Removing one revokes access immediately. |
| `AUTH_SECRET` | `openssl rand -base64 48`. Rotating it signs everyone out. |
| `RESEND_API_KEY` | From resend.com (domain verified for `MAIL_FROM`). |
| `MAIL_FROM` | e.g. `CDL Editors <editors@your-domain>` |
| `GITHUB_TOKEN` | Fine-grained token: repo `community-data-libraries/backend`; Contents read/write, Pull requests read/write. |
| `GITHUB_REPO` | Optional; defaults to `community-data-libraries/backend`. Point at a fork to test. |
| `SITE_ORIGIN` | Exact site origin, e.g. `https://cdl.netlify.app` (no trailing slash). Deploy previews have a different origin, so editing is disabled there. |

## Build hook

Create a build hook in Netlify (Site configuration → Build & deploy → Build hooks) and save its
URL as the `NETLIFY_BUILD_HOOK` secret in the backend repo. The backend's
`netlify-rebuild.yml` workflow calls it when `data/**` changes on `main`.

## Tags

Allowed tags come from `backend/data/tag_vocabulary.yml`. Tag groups an editor changes are listed
in the dataset's `manual_tags` and are not overwritten by the pipeline. To hand a group back to the
pipeline, remove it from `manual_tags` in a pull request.

## Local testing

`npm run test:functions` runs the unit tests. For an end-to-end check use `netlify dev` with the
variables above in `.env`, `SITE_ORIGIN=http://localhost:8888`, and `GITHUB_REPO` set to a fork.
