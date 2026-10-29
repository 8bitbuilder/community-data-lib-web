# Community libraries: storage, librarian portal and functions

A community library is a filtered view of the main catalog: a landing page, a catalog filtered to
one county, and Teacher, Student and Community roles. Its record is small. The county FIPS code
is the key that drives the filtering. Visitors never log in; only librarians do.

## Where the records live

Records live in Netlify Database (Postgres). The tables are created by the migrations in
`netlify/database/migrations/`, which Netlify applies on every deploy, just before it is
published.

### `communities`

| Column | Notes |
|---|---|
| `slug` | Primary key. Never changes; it is in the page URL. |
| `name` | Required. |
| `place_name`, `description` | Optional. |
| `county_fips` | 5 digits. Unique: one library per county. |
| `created_by` | The registrant's email. |
| `approved_at`, `approved_by` | `NULL` until an admin approves the library. Only approved libraries are built into the site. |
| `created_at`, `updated_at` | Timestamps. |

State code and county name are **not stored**. They are derived from `county_fips` with the
Census vocabulary (`src/data/geo-vocabulary.json`), which also decides whether a code is valid.

### `community_editors`

`(community_slug, email, added_by, added_at)`: which Identity emails may edit each library.

## How the build reads them

`src/content.config.ts` loads the `communities` collection through
`src/lib/community/communityStore.mjs`.

| Situation | What the build does |
|---|---|
| `NETLIFY_DB_URL` is set | Reads approved rows from Netlify Database through `@netlify/database` |
| Not set (local builds, CI, GitHub Pages) | Reads the Markdown files in `src/content/communities/`, with a loud warning |
| The table does not exist yet (the first deploy after the migrations were added; Netlify migrates after the build) | Falls back to the files, with a warning |
| Any other database error in a production build | **Fails**, so the site never publishes without its libraries |
| A county code not in the vocabulary | Fails the build |

`src/content/communities/*.md` stay as the fallback and as the seed input.

**The database is the source of truth once `NETLIFY_DB_URL` is set.** Decap at `/admin/` still
edits the Markdown files, but those edits only change the fallback and the seed input: they do
not reach the production pages. The team edits live libraries in `/librarian/` as an `admin` or
as one of the library's editors.

The database keeps fewer fields than the Markdown files. The seed copies `name`, `place_name`,
`description` and `county_fips`; it does not copy `state_code`, `county`, `zip_codes` or
`librarian_email(s)` (editors are added with `--editor`).

## Seeding

`npm run db:seed` (`scripts/seed-communities.mjs`) copies the Markdown libraries into the database
as approved, and adds editors:

```bash
NETLIFY_DB_URL=<production connection string> npm run db:seed -- --editor librarian@example.org
npm run db:seed -- --dry-run --editor librarian@example.org   # print the SQL instead
```

It is safe to re-run: it upserts by slug, keeps an existing approval, and never removes editors.

## Rules

`src/lib/community/librarianRules.mjs` holds the rules as pure functions, tested in
`tests/librarianRules.test.ts`.

| Action | Who | Notes |
|---|---|---|
| Register a library | Anyone logged in | Starts pending; the registrant becomes the first editor |
| Edit a library | Its editors | The slug never changes; a new county must be in the vocabulary and not taken |
| Add or remove editors | Its editors | At most 10 editors; never remove the last one |
| Approve or reject a pending library | Identity role `admin` | Rejecting deletes the library |

## The librarian function

The routes are served by `netlify/functions/librarian-api.mjs` and `netlify/lib/librarianApi.mjs`,
under `/api/librarian/libraries`:

| Method and path | Who | What |
|---|---|---|
| `GET /` | logged in | Libraries you edit (+ pending ones for admins) |
| `POST /` | logged in | Register (pending) |
| `GET /:slug` | editors, admins | One library with its editors |
| `PUT /:slug` | editors | Edit |
| `POST /:slug/editors` | editors | Add an editor `{ email }` |
| `DELETE /:slug/editors/:email` | editors | Remove an editor |
| `POST /:slug/approve` | admins | Approve |
| `DELETE /:slug` | admins | Reject a pending library |

- **Login:** `@netlify/identity` `getUser()` reads the `nf_jwt` cookie that the `/librarian/`
  pages set when someone logs in.
- **Origin check:** every write checks the `Origin` header, because the login is a cookie.
- **Database access:** SQL is in `netlify/lib/communityDb.mjs` (pg-style pool from
  `getDatabase().pool`; transactions for registration; a database guard against removing the
  last editor).
- **Rebuilds:** after an **approval** or an **edit to an approved library**, the function calls
  the build hook in `COMMUNITY_BUILD_HOOK_URL`, so the static pages rebuild.
  - Each call is a production build and deploy.
  - Pending registrations and editor changes don't touch public pages, so they don't rebuild.
  - Without the variable, the write succeeds and the rebuild is skipped with a warning.
- **Contact form:** the `library-contact` function forwards a visitor's message to an approved
  library's editors (Resend), without showing their emails.

## Pages

| Page | Purpose |
|---|---|
| `/librarian/login/` | Log in, create an account, reset a password, and handle the links in Identity emails |
| `/librarian/` | My libraries; pending approvals for admins |
| `/librarian/register/` | Register a library: name, county (searchable list from the vocabulary), place name, web address, description |
| `/librarian/<slug>/edit/` | Edit details and editors |

- **One edit page:** a single static page, `dist/librarian/edit/index.html`, serves every
  library through a rewrite in `netlify.toml`, so libraries registered after the last build can
  be edited. Locally, use `/web/librarian/edit/?slug=<slug>`.
- **Where Identity loads:** `@netlify/identity` is imported only by `src/lib/librarian/client.ts`,
  and only these pages use it.
- **Email links:** Identity email links land on the home page with a token in the hash.
  `Layout.astro` has a few lines of inline script that forward them to `/librarian/login/`. No
  Identity code loads on public pages.

## Testing

- **Unit tests** (`npm test`):
  - rules
  - the API handler (in-memory store; `tests/support/memoryCommunityDb.mjs`)
  - the build hook
  - the contact form
  - the community store (fake database)
  - the seed statements
  - the portal helpers
- **SQL:** Netlify's local database emulator (`@netlify/database-dev`, or `netlify dev` with
  `netlify database migrations apply`) runs the migrations. The store, seed script and
  `communityDb.mjs` were checked against it. Run a build against it with
  `NETLIFY_DB_URL=postgres://... npm run build`.
- **Identity:** Identity does not work on localhost or with `netlify dev`. The pages say so there.
  A real login, registration, approval and rebuild can only be tested on a deploy preview or the
  production site.

## Netlify settings

See [netlify-setup-checklist.md](netlify-setup-checklist.md).
