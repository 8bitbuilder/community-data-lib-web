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

**In production (Netlify)** the same `/api/*` routes are served by a Netlify Function, `netlify/functions/preview-api.mjs`; no separate server runs. The function and `backend/server.mjs` share `backend/lib/apiHandler.mjs`. The function reads sources from the SQLite export (`backend/data/exports/catalog.json`) and uses the Node preview engine (no pandas). Excel datasets (`.xlsx` and legacy `.xls`, also inside a `.zip`) are previewed too: the page picks the sheet and header row automatically and lets visitors choose another sheet or header row. Sources without a direct download link return "can't be previewed yet" instead of an error page.

Base URL (direct): `http://localhost:4323`. Endpoints are listed in [backend/README.md](backend/README.md).

## Clean this data (notebook for teachers)

The Data Preview page (`/web/data-preview`) has a **Clean this data** notebook under the preview. It runs Python (pandas) right in the browser with [Pyodide](https://pyodide.org), so there is nothing to install and nothing is sent to a server.

- **Open notebook** loads the dataset into a table called `df`. The first cell is the load step; for Excel files it uses the sheet and header row shown in the preview.
- **+ Cleaning step** adds common steps without typing code (drop columns or rows, drop or fill missing values, rename a column, change a column's type, keep only matching rows, remove duplicates). Each step becomes a short, commented Python cell that students can read and edit.
- **Use my own file** loads a CSV, TSV, TXT, XLSX or XLS file from your computer instead.
- **Export** downloads the cleaned table (CSV or Excel) or the whole notebook as a `.ipynb` file that opens in Jupyter or Google Colab and re-downloads the original data itself.
- Cells are saved in your browser, so they come back when you return to the same dataset. **Reset** starts over; **Stop** restarts Python if a cell runs too long.

The first open downloads Python into the browser, so it can take a little while. Files larger than `PREVIEW_FILE_MAX_BYTES` (4 MB by default) are not opened automatically; download them and use **Use my own file**.

## Geographic Markers

- Canonical markers stored in [data/geo/markers.geojson](data/geo/markers.geojson).
- Properties validated against [data/geo/schema/marker.schema.json](data/geo/schema/marker.schema.json).
- Lint and validate locally:

```bash
npm run validate:geo
```

Contribution guidelines are in [data/geo/README.md](data/geo/README.md).

## Decap CMS Setup & Netlify Configuration

Decap CMS is available at `/admin` (or `/web/admin/` when served with base path) so community librarians can maintain their **community configuration**: library name, place name, slug, and geographic identifiers (county FIPS is the main filter).

Decap does **not** manage datasets. The dataset catalog comes from the backend pipeline (`npm run sync:catalog` generates `src/content/master-library/datasets/` during `prebuild`), and each community library is a filtered view of that catalog. New datasets go through the main site's **Suggest a Data Resource** form (`/submit`).

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
