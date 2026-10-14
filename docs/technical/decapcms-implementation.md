# DecapCMS Implementation Plan

This project now includes a DecapCMS starter at `public/admin` for Netlify deployment.

## Why this setup

Based on DecapCMS docs, the minimum static-site integration is:
- `admin/index.html` loading DecapCMS from CDN
- `admin/config.yml` defining backend and content collections

DecapCMS works with or without Netlify, but on Netlify the typical path is `git-gateway` + Netlify Identity for authentication.

## What is added

- `public/admin/index.html`
- `public/admin/config.yml`
- `local_backend: true` enabled for local editing workflow

## Netlify steps

1. In Netlify site settings, enable **Identity**.
2. Under Identity, enable **Git Gateway**.
3. Invite content editors (or enable registration based on policy).
4. Deploy and open `/web/admin/`.

## Local editing flow

1. Start Astro dev server.
2. In a second terminal, run:
   - `npx decap-server`
3. Open `http://localhost:4321/web/admin/`.

`local_backend` is for local development only.

## Notes for this repo

- Decap manages **community configuration only**: `src/content/communities/*.md`
  (`name`, `place_name`, `slug`, `state_code`, `county`, `county_fips`, `zip_codes`). Librarian
  emails are kept privately by the librarian portal, not in these files.
- There is no dataset collection in Decap. Datasets are generated from the backend
  pipeline into `src/content/master-library/datasets/` and must be maintained there.
- Community libraries (`/communities/<slug>/`) are filtered views of the main catalog.
- Community librarians now use the librarian portal (`/librarian/`, see the README) rather
  than Decap; Decap is kept for the team, with Git Gateway restricted to a team role.
  Visitors never sign in; the Teacher / Student / Community Member choice only customizes
  the catalog view.
