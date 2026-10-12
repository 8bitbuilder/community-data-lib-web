# Community Data Libraries - Web

Astro-based site for Community Data Libraries (CDL). This repo also hosts geographic marker data for mapping resources.

## Development

```bash
npm install
npm run dev
```

## Backend Starter

A minimal backend is available in `backend/` and reads YAML source files from `backend/data/sources/`.

For data preview pages, run **both** servers in separate terminals:

```bash
npm run backend:dev   # preview API on http://localhost:4323
npm run dev           # Astro site on http://localhost:4321/web
```

In development, the Astro dev server proxies `/api/sources` and `/api/health` to the preview API, so you usually do not need `PUBLIC_API_BASE_URL` in `.env`.

**In production (Netlify)** the same `/api/*` routes are served by a Netlify Function, `netlify/functions/preview-api.mjs`; no separate server runs. The function and `backend/server.mjs` share `backend/lib/apiHandler.mjs`. The function reads sources from the SQLite export (`backend/data/exports/catalog.json`) and uses the Node preview engine (no pandas). Excel (`.xlsx`) datasets and sources without a direct download link return "can't be previewed yet" instead of an error page.

Base URL (direct): `http://localhost:4323`

## Geographic Markers

- Canonical markers stored in [data/geo/markers.geojson](data/geo/markers.geojson).
- Properties validated against [data/geo/schema/marker.schema.json](data/geo/schema/marker.schema.json).
- Lint and validate locally:

```bash
npm run validate:geo
```

Contribution guidelines are in [data/geo/README.md](data/geo/README.md).

## Librarian Portal (community libraries)

Community librarians register and maintain their community library at `/librarian/` (`/web/librarian/` with the base path). Site visitors never log in.

- Anyone can sign up with Netlify Identity. Once their email is confirmed they can register a library: name, place name, description, state, county FIPS code, and ZIP codes. Their login email becomes the library's first entry in `librarian_emails`.
- Each county can have one library, and each web address (slug) is unique; duplicates are rejected.
- A librarian can edit only the libraries whose `librarian_emails` include their login email, and can add or remove other librarians (a library always keeps at least one).
- Saves go through the `librarian-api` Netlify Function (`netlify/functions/librarian-api.mjs`). It verifies the Identity token, checks permissions, validates the fields, and commits `src/content/communities/<slug>.md` to GitHub. The commit triggers a normal Netlify build, so changes go live a few minutes later.
- The rules live in `src/lib/community/librarianRules.mjs` and are covered by `npm test`.

### Netlify setup

1. **Identity**: Site configuration > Identity > **Enable Identity** (if it isn't already).
2. **Registration**: Identity > Registration preferences > **Open**, so new librarians can sign up. Leave email confirmation on (do not enable autoconfirm); the function only accepts confirmed emails.
3. **Lock down Decap's Git Gateway**: once registration is open, any signed-up user could use Decap's Git Gateway to edit the repo. Under Identity > Services > Git Gateway, restrict access to a role (for example `admin`), then give that role to team members under Identity > Users > (user) > Edit settings.
4. **GitHub token**: create a fine-grained personal access token (or a token for a bot account) with access to **only** `community-data-libraries/web` and **Contents: Read and write**. Note when it expires and rotate it before then.
5. **Environment variables**: Site configuration > Environment variables, scoped to **Functions**:

   | Variable | Required | Value |
   | --- | --- | --- |
   | `LIBRARIAN_GITHUB_TOKEN` | yes | The token from step 4. Never commit it. |
   | `LIBRARIAN_GITHUB_REPO` | no | `owner/name`; defaults to `community-data-libraries/web` |
   | `LIBRARIAN_GITHUB_BRANCH` | no | Branch the site deploys from; defaults to `main` |

   Without `LIBRARIAN_GITHUB_TOKEN` the portal loads but saving returns "not configured".

### Testing

`npm test` covers the permission and validation rules and the function's handler, using a fake Identity service and an in-memory repo. Real sign-up, the confirmation email, Identity tokens, GitHub commits and the rebuild only work on a deployed Netlify site (a deploy preview is fine; deploy previews share the site's Identity users). The Identity widget does not load on `localhost`, so locally the portal shows a "sign-in isn't available" message.

## Decap CMS (team editing)

Decap CMS is still available at `/admin` (or `/web/admin/` with the base path) for the Community Data Libraries team to edit community configuration directly: library name, place name, slug, geographic identifiers, and librarian emails. Librarians should use the portal instead; Decap cannot restrict a user to their own library. It uses Git Gateway, which Netlify has deprecated, and will be removed once the portal covers the team's needs.

Decap does **not** manage datasets. The dataset catalog comes from the backend pipeline (`npm run sync:catalog` generates `src/content/master-library/datasets/` during `prebuild`), and each community library is a filtered view of that catalog. New datasets go through the main site's **Suggest a Data Resource** form (`/submit`).

To use Decap on Netlify: enable Identity, enable **Git Gateway** under Identity > Services (restricted to a team role, see step 3 above), give team members that role, and open `/web/admin/`.

## Documentation

- Site architecture, routing, content model, CI/CD: [docs/technical/architecture.md](docs/technical/architecture.md)
- Netlify deployment: [docs/technical/netlify.md](docs/technical/netlify.md)
- Geo data branching guidance: [docs/technical/geo-branching.md](docs/technical/geo-branching.md)
- Community library structure: [docs/data/community-library-structure.md](docs/data/community-library-structure.md)
- Datasheet requirements: [docs/data/datasheet-requirements.md](docs/data/datasheet-requirements.md)
- DecapCMS implementation: [docs/technical/decapcms-implementation.md](docs/technical/decapcms-implementation.md)
