# Community Data Libraries - Web

Astro-based site for Community Data Libraries (CDL). Dataset metadata comes from the sibling `backend` repo (its SQLite export is the source of truth).

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

Community librarians register and maintain their community library at `/librarian/` (`/web/librarian/` with the base path). Site visitors never log in.

- **Registering**: anyone can sign up with Netlify Identity. Once their email is confirmed they can register a library: name, place name, description, state, county FIPS code, and ZIP codes. They become its first librarian.
- **Approval**: a registration opens a pull request (branch `library/<slug>`) adding `src/content/communities/<slug>.md`. The team approves it by **merging** (it goes live on the next deploy) or rejects it by **closing** it. `.github/CODEOWNERS` requests a review from the team on these pull requests, which is the approval email.
- **One library per county**: each county and each web address (slug) can have only one library, including ones awaiting approval. A rejected registration frees them again. When a county is taken, the portal links to that library and to the list of all libraries.
- **Editing**: a librarian can edit only their own approved libraries, and can add or remove other librarians (a library always keeps at least one). Edits commit straight to `main`.
- **Private emails**: librarian emails are never in the repo, commits, pull requests, or the built site. They live in the site's private [Netlify Blobs](https://docs.netlify.com/blobs/overview/) store `librarians` (one JSON record per library), which only the functions can read. Approval pull requests show a masked email (`j***@utk.edu`).
- **Contacting a librarian**: each library page has a *Contact the librarian* form. The `library-contact` function forwards the message by email through [Resend](https://resend.com) with the visitor as Reply-To, so visitors never see a librarian's address.

Code: `netlify/functions/librarian-api.mjs` and `library-contact.mjs`, with helpers in `netlify/lib/`. The permission and validation rules are in `src/lib/community/librarianRules.mjs`. All of it is covered by `npm test`.

### Why a custom portal instead of Decap for librarians

- **Decap can't limit a user to one library.** Anyone who can log into Decap can edit every community file (and, through Git Gateway, anything else in the repo). The portal only lets a librarian change the libraries they maintain.
- **Git Gateway is deprecated by Netlify.** The portal commits through the GitHub API with a token the function holds, so it doesn't depend on Git Gateway.
- **Private librarian emails.** Decap can only edit fields stored in the public repo; the portal keeps librarian emails in a private store.
- **Self-service sign-up with approval and duplicate checks**, which Decap doesn't offer.

Librarians can edit the same community fields they could in Decap (name, place name, description, state, county, county FIPS, ZIP codes) plus their library's list of librarians. They cannot change a library's web address, edit other libraries, or touch any other file. The team keeps Decap at `/admin` for direct edits.

### Netlify setup

1. **Identity**: Site configuration > Identity > **Enable Identity** (if it isn't already).
2. **Lock down Decap's Git Gateway first**: once registration is open, any signed-up user could use Decap's Git Gateway to edit the repo. Under Identity > Services > Git Gateway, restrict access to a role (for example `admin`), then give that role to team members under Identity > Users > (user) > Edit settings.
3. **Registration**: Identity > Registration preferences > **Open**, so new librarians can sign up. Leave email confirmation on (do not enable autoconfirm); the functions only accept confirmed emails.
4. **GitHub token**: create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) (ideally owned by the organization or a bot account):
   - **Resource owner**: `community-data-libraries`; **Repository access**: *Only select repositories* > `community-data-libraries/web`.
   - **Repository permissions**: **Contents: Read and write** (read files, create `library/<slug>` branches, commit edits) and **Pull requests: Read and write** (open approval pull requests and check whether they were merged). Metadata: Read-only is added automatically. Nothing else.
   - Set an expiration and rotate the token before it expires. If `main` is protected, the token's account must be allowed to push to it, or librarian edits will fail.
5. **Email for the contact form**: create a [Resend](https://resend.com) account, verify a sending domain (for example `communitydatalibraries.org`), and create an API key with *Sending access*.
6. **Environment variables**: Site configuration > Environment variables, scoped to **Functions**:

   | Variable | Required | Value |
   | --- | --- | --- |
   | `LIBRARIAN_GITHUB_TOKEN` | yes | The token from step 4. Never commit it. |
   | `LIBRARIAN_GITHUB_REPO` | no | `owner/name`; defaults to `community-data-libraries/web` |
   | `LIBRARIAN_GITHUB_BRANCH` | no | Branch the site deploys from; defaults to `main` |
   | `RESEND_API_KEY` | for the contact form | The Resend API key from step 5 |
   | `CONTACT_FROM_EMAIL` | for the contact form | Sender on the verified domain, e.g. `Community Data Libraries <librarians@communitydatalibraries.org>` |

   Without `LIBRARIAN_GITHUB_TOKEN` the portal loads but saving returns "not configured"; without the Resend variables the contact form says it isn't set up yet.
7. **Librarians for existing libraries**: libraries created before the portal (Knox County) have no librarians until one is added. With the Netlify CLI linked to the site:

   ```bash
   netlify blobs:set librarians knox-county '{"emails":["librarian@example.org"],"status":"approved","name":"Knox County Data Library","county_fips":"47093"}'
   ```

   `netlify blobs:get librarians <slug>` shows a library's record, including the full email of whoever registered it.

### Testing

- **Unit tests**: `npm test` covers the permission and validation rules, the approval flow, and the contact form, using a fake Identity service, an in-memory repo and Blobs store, and a fake email sender.
- **Full flow locally** with the [Netlify CLI](https://docs.netlify.com/cli/get-started/) (needs Identity enabled on the deployed site):
  1. `npm install -g netlify-cli`, then `netlify login` and `netlify link` (pick the site).
  2. Create a `.env` file (git-ignored) pointing saves at a **test branch of a fork**, so testing never publishes to the live site (registrations open pull requests against that branch):

     ```bash
     LIBRARIAN_GITHUB_TOKEN=<fine-grained token with Contents read/write on the fork>
     LIBRARIAN_GITHUB_REPO=<your-user>/web
     LIBRARIAN_GITHUB_BRANCH=librarian-test
     LIBRARIAN_IDENTITY_URL=https://<site>.netlify.app/.netlify/identity
     ```

     The branch must already exist on the fork.
  3. Run `netlify dev` and open `http://localhost:8888/web/librarian/`. The first time, the Identity widget asks for the site URL; enter `https://<site>.netlify.app`. Sign-up, login and the confirmation email use the deployed site's real Identity users.
- **Deploy preview**: on a deploy preview, set the same variables for the *Deploy Previews* context (Site configuration > Environment variables > Deploy previews) so test saves go to a test branch, not `main`. `LIBRARIAN_IDENTITY_URL` isn't needed there.

## Decap CMS (team editing)

Decap CMS is still available at `/admin` (or `/web/admin/` with the base path) for the Community Data Libraries team to edit community configuration directly: library name, place name, slug, geographic identifiers, and librarian emails. Librarians should use the portal instead; Decap cannot restrict a user to their own library. It uses Git Gateway, which Netlify has deprecated, and will be removed once the portal covers the team's needs.

Decap does **not** manage datasets. The dataset catalog comes from the backend pipeline (`npm run sync:catalog` generates `src/content/master-library/datasets/` during `prebuild`), and each community library is a filtered view of that catalog. New datasets go through the main site's **Suggest a Data Resource** form (`/submit`).

To use Decap on Netlify: enable Identity, enable **Git Gateway** under Identity > Services (restricted to a team role, see step 3 above), give team members that role, and open `/web/admin/`.

## Documentation

- Site architecture, routing, content model, CI/CD: [docs/technical/architecture.md](docs/technical/architecture.md)
- Netlify deployment: [docs/technical/netlify.md](docs/technical/netlify.md)
- Coverage model, boundaries and county vocabulary: [docs/technical/coverage-and-boundaries.md](docs/technical/coverage-and-boundaries.md) and [public/geo/boundaries/README.md](public/geo/boundaries/README.md)
- Data previews (Tier 1 static files): [docs/technical/previews.md](docs/technical/previews.md)
- Community library structure: [docs/data/community-library-structure.md](docs/data/community-library-structure.md)
- Datasheet requirements: [docs/data/datasheet-requirements.md](docs/data/datasheet-requirements.md)
- DecapCMS implementation: [docs/technical/decapcms-implementation.md](docs/technical/decapcms-implementation.md)
