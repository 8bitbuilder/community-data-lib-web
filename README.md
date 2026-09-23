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

Base URL (direct): `http://localhost:4323`

## Geographic Markers

- Canonical markers stored in [data/geo/markers.geojson](data/geo/markers.geojson).
- Properties validated against [data/geo/schema/marker.schema.json](data/geo/schema/marker.schema.json).
- Lint and validate locally:

```bash
npm run validate:geo
```

Contribution guidelines are in [data/geo/README.md](data/geo/README.md).

## Decap CMS Setup & Netlify Configuration

Decap CMS is available at `/admin` (or `/web/admin/` when served with base path) to allow community librarians to author and manage community profiles and datasets.

To enable the CMS on a Netlify-hosted deployment using `git-gateway`:

1. **Host Repository**: Ensure the repository is hosted on **GitHub.com** or **GitLab.com** (required by Netlify Git Gateway).
2. **Enable Netlify Identity**:
   - In the Netlify dashboard, navigate to **Site configuration** > **Identity** (or the **Identity** tab).
   - Click **Enable Identity**.
3. **Configure Registration Preferences**:
   - Under Identity settings, go to **Registration preferences**.
   - Change registration from *Open* to **Invite only** so that only authorized maintainers and librarians can access the CMS.
4. **Enable Git Gateway**:
   - In Identity settings, scroll to **Services** > **Git Gateway**.
   - Click **Enable Git Gateway** to connect Netlify Identity with repository commit access.
5. **Invite Maintainers & Librarians**:
   - Navigate to the **Identity** tab in your Netlify dashboard.
   - Click **Invite users** and enter the email address of the maintainer or community librarian.
   - The invited user will receive an email invitation to accept and set their password, which will direct them to `/admin/` to begin managing content.

## Documentation

- Site architecture, routing, content model, CI/CD: [docs/technical/architecture.md](docs/technical/architecture.md)
- Netlify deployment: [docs/technical/netlify.md](docs/technical/netlify.md)
- Geo data branching guidance: [docs/technical/geo-branching.md](docs/technical/geo-branching.md)
- Community library structure: [docs/data/community-library-structure.md](docs/data/community-library-structure.md)
- Datasheet requirements: [docs/data/datasheet-requirements.md](docs/data/datasheet-requirements.md)
- DecapCMS implementation: [docs/technical/decapcms-implementation.md](docs/technical/decapcms-implementation.md)
