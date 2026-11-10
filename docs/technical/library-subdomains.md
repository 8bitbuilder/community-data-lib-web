# Design note: a subdomain for each community library (web#31)

Status: **decided 2026-11-10: option (b), an edge function with a wildcard domain.** Built in
the PR that closes web#31. Setup and dashboard steps: [netlify.md](netlify.md#library-subdomains-web31).

Goal: `knox-county.communitydatalibraries.org` shows the Knox County library, the same pages
that live today at `/web/communities/knox-county/`.

## Facts that shape the choice

- **One Netlify site, static pages.** A library's pages exist only after a production build.
  An approval in the librarian portal already calls the build hook, so a library goes live
  with one deploy (15 credits) whatever we pick here.
- **The slug is the natural subdomain.** It never changes, and the rules already limit it to
  lowercase letters, digits and single hyphens, up to 60 characters. That is a valid DNS label
  (63 is the maximum). The issue's `knoxville` would need a second, editable field; using the
  slug avoids that.
- **Pages link with the `/web` base.** On a subdomain, links inside the library should become
  `/` and `/catalog/`. Links to main-site pages (Data Resources, Suggest, Data Preview, the
  #40 "Back to Community Data Libraries" bar) must become absolute links to the main site, or
  they would show the main site under the library's subdomain.
- **Netlify facts (docs read 2026-11-10):**
  - Automatic branch subdomains need Netlify DNS and give one subdomain per Git branch.
  - Redirect rules can match a full URL with a host, with status 200, but only an exact host:
    there are no placeholders or wildcards in the host.
  - An edge function can read the host and rewrite to another path on the same site with a 200.
  - Edge functions are billed as web requests (2 credits per 10,000), not as compute.
  - Branch deploys and deploy previews cost 0 credits.
  - Netlify recommends at most 50 domain aliases per site. With more than 5 aliases on one
    domain, certificate rate limits can hit; their advice is a wildcard certificate (automatic
    with Netlify DNS) or contacting support first.
  - **Not confirmed in the docs:** whether a site can take a wildcard alias `*.example.org`.
    It is not documented; it probably needs a support request.

## The options

### (a) Branch subdomains (what the issue links)

One Git branch per library (`knox-county`), each deployed as a branch deploy at
`knox-county.communitydatalibraries.org`.

- **DNS:** the domain (or a delegated subdomain) must use Netlify DNS.
- **Cost:** branch builds are 0 credits, but every branch must rebuild after every change to
  `main` or the data, or it goes stale. With N libraries that is N builds per push, queued
  behind each other.
- **New library:** something must create a Git branch on approval (a GitHub token in the
  function, which the old portal had and we removed). Each branch builds the whole site, and
  its root is the main home page unless each branch is configured differently.
- **Data:** deploy previews get their own database branch, not production data. Branch deploys
  likely do too, so a branch site could show stale or missing libraries.
- **Link back (#40):** absolute link to the main site; same change as (b).
- **Verdict:** built for staging branches, not for tenants. Doesn't fit libraries added at
  runtime.

### (b) One site, routed by hostname

The site also answers on `<slug>.communitydatalibraries.org`. A small edge function reads the
host and rewrites `/` and `/catalog/` to `/communities/<slug>/` and `/communities/<slug>/catalog/`.
Assets (`/web/_astro/...`) and functions pass through untouched. An unknown slug gets the 404
page. `/web/communities/<slug>/...` on the main host gets a 301 to the subdomain.

Two ways to point the hosts at the site; the code is the same for both:

- **(b1) Wildcard:** DNS `*.communitydatalibraries.org` and a wildcard alias on the site.
  - **DNS:** Netlify DNS for the domain, so Netlify issues the wildcard certificate, plus a
    request to Netlify support to accept the wildcard alias (not documented).
  - **New library:** nothing to do. Approval rebuilds the site and the subdomain works.
- **(b2) One alias per library:** a CNAME and a domain alias in the dashboard for each library.
  - **DNS:** any provider.
  - **New library:** a manual dashboard step after each approval. The 50-alias guidance and the
    certificate rate limit above 5 aliases make this a stopgap, not a plan.

Netlify redirect rules alone can't do (b1): they can't put the host into a placeholder. They
could do (b2) with one generated rule per library, but the edge function covers both.

- **Cost:** no extra deploys. Each request to the site runs the function (it can skip asset
  paths). Edge functions count as web requests, 2 credits per 10,000; the docs don't say
  whether a rewritten request counts once or twice. Even counted twice, 100,000 visits a month
  is about 20 more credits. Small next to one 15-credit deploy.
- **Link back (#40):** the bar, menu and footer link to the main site's absolute address
  (a `PUBLIC_MAIN_SITE_URL` build variable). Main-site pages link to libraries by subdomain.
- **Other changes:** the contact form and librarian API check the `Origin` header; the contact
  form posts from the library's host, so its check (if any) must accept library subdomains.
  Reserve slugs that can't be libraries (`www`, `api`, `admin`, `mail`, `web`, ...).

### (c) Alternatives considered

- **(c1) Cloudflare in front.** DNS on Cloudflare with a proxied wildcard record and a Worker
  that fetches `https://<main site>/web/communities/<slug>/<path>`.
  - **DNS:** the domain on Cloudflare. Its free certificate covers `*.communitydatalibraries.org`.
  - **Cost:** Workers' free plan allows 100,000 requests a day; Netlify still bills the
    proxied requests and bandwidth as now.
  - **New library:** nothing to do.
  - **Downsides:** a second vendor, two CDNs, and Netlify sees every request as coming from
    Cloudflare. Worth it only if Netlify won't accept the wildcard.
- **(c2) Subdomain as a redirect.** `knox-county.communitydatalibraries.org` 301s to
  `/web/communities/knox-county/`. Same DNS needs as (b), no page changes, but the address bar
  doesn't keep the subdomain. A short link, not "its own subdomain".

## Recommendation

**(b) with an edge function, set up as (b1) wildcard.** It is the only Netlify-native option
where a newly approved library gets its subdomain with no manual step and no extra deploys,
and the repo change is small and testable locally (`netlify dev` with a `Host` header).

If Netlify support won't accept the wildcard alias, the same code works with per-library aliases
(b2) for the first few libraries, and (c1) is the long-term fallback.

Open questions for the team:

1. Where is DNS for `communitydatalibraries.org` today, and can it move to Netlify DNS?
2. What is the main site's public address: `communitydatalibraries.org/web/`, or another host?
