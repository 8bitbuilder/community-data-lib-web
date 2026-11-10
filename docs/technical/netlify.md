# Netlify Deployment for Astro

This project uses Astro with static output, which works seamlessly on Netlify.

## Why Netlify
- Fast global CDN and automatic HTTPS
- Zero-config static builds (works out of the box with Astro)
- Branch deploys and deploy previews for PRs
- Rollbacks and immutable deploy history
- Redirects/forms/functions if needed later

## Setup
1. Create a Netlify account and connect the GitHub repo.
2. Netlify will detect the framework. If needed, set:
   - Build command: `npm run build`
   - Publish directory: `dist`
3. Commit the provided `netlify.toml` in the repo root for consistency.

Note: The current Astro config sets `base: '/web'` and `site` to GitHub Pages. If deploying at Netlify site root, you may want to temporarily remove `base` or set it to `'/'` to avoid prefixed asset paths. Alternatively, deploy to a subpath `/web` on Netlify.

## Branch Deploy Test
1. In Netlify, enable Branch Deploys for a testing branch (e.g., `netlify-test`).
2. Push commits to that branch; Netlify builds and publishes to a unique URL.
3. Verify navigation, assets, and pages load correctly.

## Deploy Main
1. Once branch tests look good, enable build for `main`.
2. Netlify will build on each push to `main` and update the production site.

## Library subdomains (web#31)

Each approved community library is served at `https://<slug>.communitydatalibraries.org/`
(home) and `/catalog/`, from the same site and the same deploy. Why this design:
[library-subdomains.md](library-subdomains.md).

### How it works

- **Edge function** `netlify/edge-functions/library-host.js` runs before the redirect rules in
  `netlify.toml`. The routing rules are in `src/lib/community/libraryHosts.mjs`, tested in
  `tests/libraryHosts.test.ts`.
  - **Library host,** e.g. `knox-county.communitydatalibraries.org`:
    - `/` and `/catalog/` are rewritten (status 200) to `/communities/knox-county/...`, and the
      address bar keeps the subdomain.
    - A missing trailing slash gets a 301 to the same path with one.
    - Files with an extension (`/web/_astro/*`, `/web/favicon.svg`, JSON) and `/api/*` pass
      through. So does the contact form.
    - Main-site pages (`/web/<page>` without an extension) get a 301 to the main site.
  - **Main site's host:** `/web/communities/<slug>/...` gets a 301 to the library's subdomain,
    so old links keep working.
  - **Any other host** (`*.netlify.app`, deploy previews, branch deploys): passes through.
  - **Unknown slug:** the build writes `/web/library-slugs.json` (the libraries in that deploy).
    The function reads it once per deploy and answers a subdomain that isn't in it with the 404
    page and status 404. The page says the library wasn't found.
- **Links** come from `libraryHref()` and `mainSiteHref()` in `src/lib/paths.ts`, which read the
  two variables below at build time.
  - Library pages link to their own pages on the subdomain.
  - Every main-site link on a library page is absolute: the "Back to Community Data Libraries"
    bar from #40, the menu and footer, Data Resources, Suggest a Data Resource and the Data
    Preview links.
  - The main site, the librarian portal and the register page show libraries by subdomain.
- **Without the variables** nothing changes. Libraries stay at `/web/communities/<slug>/` and
  the edge function lets everything through. Local builds and deploy previews work this way.
- **New libraries need nothing extra.** Approving one already starts a production deploy (see
  [community-store.md](community-store.md)). After it, the wildcard domain serves the new
  subdomain.
- **Reserved slugs:** `www`, `api`, `admin`, `web`, `mail` and others in `RESERVED_SLUGS` can't
  be registered, because they would be subdomains the site or email needs.
- **Cost:** no extra deploys. Edge functions are billed as web requests, at 2 credits per
  10,000. Built assets, `/api/*` and `/.netlify/*` are excluded, so they don't run it.

### Environment variables

Neither is a secret.

| Variable | Value | Scopes | Deploy contexts |
|---|---|---|---|
| `PUBLIC_LIBRARY_DOMAIN` | `communitydatalibraries.org` | All scopes (the build bakes it into links; the edge function reads it at runtime) | **Production only** |
| `PUBLIC_MAIN_SITE_URL` | The main site's origin, e.g. `https://communitydatalibraries.org` (no path) | All scopes | **Production only** |

Production only keeps deploy previews on path addresses, which they need: their hostnames
aren't library subdomains.

### Dashboard steps (do these in order)

These are settings code can't change. Steps 1 to 4 can be done before this branch is merged.
Merging without the variables changes nothing on the live site.

1. **Main site domain.**
   - Domain management > Production domains > **Add a domain**: `communitydatalibraries.org`,
     if the site doesn't have it yet.
   - Its address is then `https://communitydatalibraries.org/web/`. The `/` → `/web/` redirect
     already handles the bare domain.
2. **Netlify DNS for `communitydatalibraries.org`.** This is needed for the wildcard
   certificate.
   - Domain management > the domain > **Set up Netlify DNS**.
   - **Before you change nameservers,** copy every existing record into Netlify DNS: email (MX),
     SPF and DKIM for Resend, which sends from `@communitydatalibraries.org`, and any
     verification TXT records. Missing ones break email.
   - At the registrar, set the nameservers to the four Netlify shows. This can take up to 24
     hours.
3. **Wildcard subdomain.**
   - The docs don't describe adding a wildcard alias to a site. Ask Netlify support
     (support.netlify.com) to add `*.communitydatalibraries.org` to this site.
   - Ask them which DNS record they want, usually a `*` record in Netlify DNS pointing at the
     site.
   - Ask before adding any per-library aliases: Netlify warns of certificate rate limits beyond
     5 aliases on one domain.
4. **HTTPS.**
   - Domain management > HTTPS > **Verify DNS configuration**, then **Provision certificate**.
   - With Netlify DNS, Netlify issues a wildcard certificate. Opening
     `https://knox-county.communitydatalibraries.org/web/favicon.svg` should show a valid
     certificate.
5. **Variables.** Site configuration > Environment variables > **Add a variable**: the two above,
   with **Different value for each deploy context** set for Production only.
6. **`SITE_ORIGIN`.** If the main site's address changed in step 1, set `SITE_ORIGIN` to it
   (see [environment-variables.md](environment-variables.md#site_origin)). The metadata editor
   rejects requests from any other origin.
7. **Deploy.**
   - Merge the branch, or Deploys > **Trigger deploy** > Deploy site. One production deploy,
     15 credits.
   - The variables only reach links at build time, so this deploy is required.
8. **Check.**
   - `https://knox-county.communitydatalibraries.org/` shows the Knox County library with its
     styles, and the address stays on the subdomain.
   - `/catalog/?audience=teacher` works there, and `/catalog` gets a 301 to `/catalog/`.
   - "Back to Community Data Libraries" opens `https://communitydatalibraries.org/web/`.
   - `https://communitydatalibraries.org/web/communities/knox-county/` gets a 301 to the subdomain.
   - The contact form on the library page sends.
   - `https://nowhere.communitydatalibraries.org/` shows the "couldn't find that community
     library" 404.
   - A deploy preview still shows libraries at `/web/communities/<slug>/`.

**If support won't add the wildcard:** add each library's subdomain as a domain alias
(Domain management > Add a domain alias, e.g. `knox-county.communitydatalibraries.org`) after it
is approved. The code works unchanged. Netlify recommends at most 50 aliases per site, so this
is a stopgap. The long-term fallback is Cloudflare in front, option (c1) in
[library-subdomains.md](library-subdomains.md).

**To turn it off:** delete the two variables and redeploy. Links go back to paths, and the edge
function lets everything through.

### Testing locally

- `npm test` runs the routing rules (`tests/libraryHosts.test.ts`).
- **End to end with the Netlify CLI:**
  1. Build with `PUBLIC_LIBRARY_DOMAIN=cdl.localhost` and
     `PUBLIC_MAIN_SITE_URL=http://cdl.localhost:8888`.
  2. Put the same two lines in `.env` (git-ignored).
  3. Run `netlify dev --offline --dir dist --port 8888`.
  4. Open `http://knox-county.cdl.localhost:8888/`. Browsers resolve `*.localhost` to your
     machine, or use curl with `-H "Host: knox-county.cdl.localhost"`.
  - Built links use `https://`, so follow them by hand locally.
  - `netlify dev` drops a 404 returned by an edge function and serves the static file at the
    original path instead. So `nowhere.cdl.localhost:8888/` shows the main home page locally
    (`/catalog/` correctly 404s). Check unknown subdomains on the deployed site (step 8).
