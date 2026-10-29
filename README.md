# Community Data Libraries - Web

Astro-based site for Community Data Libraries (CDL). Dataset metadata comes from the sibling `backend` repo (its SQLite export is the source of truth); community library records live in Netlify Database.

## Development

```bash
npm install
npm run dev
```

## Data previews

The Data Preview page (`/data-preview?source=<id>`) reads static preview files that the backend exports (`python pythonscripts/export_previews.py` writes `data/exports/previews/`). `npm run sync:previews` copies them into the gitignored `public/previews/` during `prebuild`. Every file stays under 250 KB. Netlify Functions never read or filter datasets. `?community=<slug>` opens the preview on that library's county. Details: [docs/technical/previews.md](docs/technical/previews.md).

For backend work, the old preview API still runs locally (development only):

```bash
npm run backend:dev   # preview API on http://localhost:4323
npm run dev           # Astro site on http://localhost:4321/web (proxies /api/sources to it)
```

## Coverage Map

`/maps` shades U.S. counties by how many catalog datasets cover them, from each dataset's canonical `coverage` (nation, state FIPS or county FIPS, from the backend). Click a county to list its datasets. The boundaries are one TopoJSON file built from the Census cartographic boundary files (2025, 1:20m) and committed. The same county file produces `src/data/geo-vocabulary.json`, the site's list of valid state and county codes:

```bash
npm run geo:boundaries -- --backend ../backend   # by hand; never part of the build
```

`npm run check:geo` (in `prebuild`) fails the build if any coverage or community FIPS code isn't in the vocabulary. Details: [docs/technical/coverage-and-boundaries.md](docs/technical/coverage-and-boundaries.md).

## Librarian Portal (community libraries)

Community librarians register and maintain their library at `/librarian/` (`/web/librarian/`). Site visitors never log in.

- **Records**: Netlify Database tables `communities` and `community_editors` (migrations in `netlify/database/migrations/`). The build reads approved libraries from the database, or falls back to `src/content/communities/*.md` with a loud warning when there is none (local builds, CI).
- **Accounts**: Netlify Identity through `@netlify/identity`, loaded only on `/librarian/` pages.
- **Registering**: anyone logged in can register a library and pick its county from a searchable list. It starts pending, and the registrant is its first editor. One library per county.
- **Approval**: users with the Identity role `admin` approve or reject pending libraries on `/librarian/`.
- **Editing**: only a library's editors can edit it or add and remove editors (never the last one).
- **Rebuilds**: approving a library, or changing a public field of an approved one, calls the build hook in `COMMUNITY_BUILD_HOOK_URL`, so the static pages rebuild. Each call is a production deploy; see the cost notes in [community-store.md](docs/technical/community-store.md#costs).
- **Contact form**: each library page has a *Contact the librarian* form. The `library-contact` function emails the editors through Resend without showing their addresses.

Code: `netlify/functions/librarian-api.mjs` and `library-contact.mjs`, with helpers in `netlify/lib/`. The rules are in `src/lib/community/librarianRules.mjs` and are covered by `npm test`. One-time seed from the Markdown files: `npm run db:seed`.

Details: [docs/technical/community-store.md](docs/technical/community-store.md). Netlify settings to click: [docs/technical/netlify-setup-checklist.md](docs/technical/netlify-setup-checklist.md).

## Decap CMS (team editing)

Decap CMS is still available at `/admin` (or `/web/admin/` with the base path) for the Community Data Libraries team to edit community configuration directly: library name, place name, slug, geographic identifiers, and librarian emails. Librarians should use the portal instead; Decap cannot restrict a user to their own library. It uses Git Gateway, which Netlify has deprecated; whether to retire Decap is not decided yet.

Once the site has a Netlify Database (`NETLIFY_DB_URL`), the community pages are built from the database, so Decap edits to `src/content/communities/*.md` only change the fallback and the seed input. Edit live libraries in `/librarian/` instead (as an `admin` or one of the library's editors).

Decap does **not** manage datasets. The dataset catalog comes from the backend pipeline (`npm run sync:catalog` generates `src/content/master-library/datasets/` during `prebuild`), and each community library is a filtered view of that catalog. New datasets go through the main site's **Suggest a Data Resource** form (`/submit`).

To use Decap on Netlify: enable Identity, enable **Git Gateway** under Identity > Services (restricted to a team role; see the [setup checklist](docs/technical/netlify-setup-checklist.md)), give team members that role, and open `/web/admin/`.

## Documentation

- Site architecture, routing, content model, CI/CD: [docs/technical/architecture.md](docs/technical/architecture.md)
- Netlify deployment: [docs/technical/netlify.md](docs/technical/netlify.md)
- Coverage model, boundaries and county vocabulary: [docs/technical/coverage-and-boundaries.md](docs/technical/coverage-and-boundaries.md) and [public/geo/boundaries/README.md](public/geo/boundaries/README.md)
- Data previews (Tier 1 static files): [docs/technical/previews.md](docs/technical/previews.md)
- Community libraries, librarian portal and functions: [docs/technical/community-store.md](docs/technical/community-store.md)
- Netlify settings checklist: [docs/technical/netlify-setup-checklist.md](docs/technical/netlify-setup-checklist.md)
- Environment variables: [docs/technical/environment-variables.md](docs/technical/environment-variables.md)
- Community library structure: [docs/data/community-library-structure.md](docs/data/community-library-structure.md)
- Datasheet requirements: [docs/data/datasheet-requirements.md](docs/data/datasheet-requirements.md)
- DecapCMS implementation: [docs/technical/decapcms-implementation.md](docs/technical/decapcms-implementation.md)
