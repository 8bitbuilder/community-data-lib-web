# Metadata editor (magic-link sign-in)

Approved editors sign in from the "Editor sign in" button in the main navbar, then submit dataset-metadata
edits from `/web/data-preview`.
Each edit opens a pull request on `community-data-libraries/backend`; merging it rebuilds the
Netlify site. Works on the Netlify deployment only.

The button opens a pop-up that asks for an email. Sign-in links open a confirm page, and the
"Sign in" button completes sign-in (this protects single-use links from email scanners). The button
stays hidden where the login service isn't running or can't start: GitHub Pages, `astro dev`, and
Netlify sites missing a required variable. It also isn't on pages using `CommunityLayout`, which has
its own navbar. If GitHub is unavailable, the editor shows a "try again" message and nothing is saved.

The pop-up reports why a sign-in request failed: the email isn't on the approved list (403), too
many attempts (429), or the email couldn't be sent (502). This is a deliberate change from the
original design, which gave the same response in every case. Anyone can now test whether an address is
approved, limited by 3 requests per email per 15 minutes and 20 per IP per hour.

Design: `backend/docs/superpowers/specs/2026-10-14-metadata-editor-auth-design.md`.

The Netlify build clones `community-data-libraries/backend@main` and syncs its data, so merged
edits appear on the next build, including the Data Preview page's static preview files.

## Netlify environment variables

See [environment-variables.md](environment-variables.md) for what each variable does, how to rotate it, and the local-development variables.

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

## Excel fields

When the download URL ends in `.xlsx` or `.xls`, the form shows two more fields, saved under
`download` in the source YAML:

| Field | YAML key | Meaning |
|---|---|---|
| Excel sheet (name or number) | `download.sheet` | Which sheet the notebook opens for an uploaded workbook (static previews read the first sheet). A name, or a 0-based position (`0` = first sheet). An all-digit entry is saved as a position, so for a sheet named like a number (`2024`) enter its position instead. |
| Header row (row number in Excel) | `download.header_row` | The 1-based row holding the column names (a whole number of 1 or more). |

Leave either blank to detect it automatically; clearing a field removes the key from the YAML.
Visitors can still choose another sheet or header row in the notebook after uploading the file.

## Tags

Allowed tags come from `backend/data/tag_vocabulary.yml`. Tag groups an editor changes are listed
in the dataset's `manual_tags` and are not overwritten by the pipeline. To hand a group back to the
pipeline, remove it from `manual_tags` in a pull request.

## Local testing

`npm run test:functions` runs the unit tests. For an end-to-end check use `netlify dev` with the
variables above in `.env`, `SITE_ORIGIN=http://localhost:8888`, and `GITHUB_REPO` set to a fork.

## Rollout order

1. Merge the backend PR (tag vocabulary, `manual_tags` support, rebuild workflow, backend CI). Backend PRs run the
   pytest suite, including vocabulary consistency; reviewers should wait for it to pass before merging.
2. Set the Netlify environment variables and create the build hook plus the `NETLIFY_BUILD_HOOK` secret.
3. Deploy the web changes. Until step 1 is done, editing returns 503 ("The tag vocabulary has not been published...").
4. Run the manual end-to-end check from "Local testing".

## Troubleshooting

- "We couldn't send the email": check `RESEND_API_KEY`, `MAIL_FROM`, Resend domain verification, and the function
  logs (`auth-request-link: email failed`).
- The pop-up says to check your email but nothing arrives: Resend accepted it, so check spam and the Resend dashboard.
- "GitHub is unavailable" on every edit: check that `GITHUB_TOKEN` has the right scope and has not expired, and that
  `GITHUB_REPO` is correct.
- "Bad origin" or sign-in disabled: `SITE_ORIGIN` must exactly match the site's origin. Deploy previews have a
  different origin, so editing is only available on the main site.
