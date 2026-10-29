# Netlify (and later Cloudflare) setup checklist

These are settings that code can't change. Do them in this order.

## Before the first deploy with the database-backed librarian portal

1. **Identity is enabled.** Project > Identity > Enable Identity (if it isn't already).
2. **Registration is Open**, so librarians can sign up.
   - Identity > Registration preferences > **Open**.
   - Keep email confirmation on: don't enable autoconfirm.
   - External providers (Google, GitHub) are optional.
3. **Approvers have the `admin` role.** Identity > Users > (team member) > Edit settings >
   Roles > `admin`. Only admins can approve or reject new libraries.
4. **Build hook for librarian edits.**
   - Site configuration > Build & deploy > Build hooks > **Add build hook** (branch `main`).
   - Copy the URL into the environment variable `COMMUNITY_BUILD_HOOK_URL`, scoped to
     **Functions**.
   - Each call is a production build and deploy. The portal only calls it for approvals and for
     edits to approved libraries.
5. **Contact form email** (if not set already): `RESEND_API_KEY` and `CONTACT_FROM_EMAIL`, scoped to
   Functions. See [environment-variables.md](environment-variables.md).

## The database

6. **Create or confirm the database:** Data & Storage > Database.
   - Netlify provisions one on the first deploy that includes `@netlify/database` and
     `netlify/database/migrations/`.
   - Or choose **Create a database manually**.
   - Migrations apply automatically on every deploy, just before it is published.
   - Deploy previews get their own database branch, copied from production when the preview is
     created.
7. **First deploy.**
   - That deploy's build can't see the new tables yet: migrations run after the build. It builds
     the community pages from `src/content/communities/*.md` and logs a warning. This is
     expected.
   - Then seed the database (step 8) and trigger one more deploy.
8. **Seed Knox County** with its current librarians:
   - See who they are: `netlify blobs:get librarians knox-county` (the old private store).
   - Copy the production connection string from the Database page.
   - Run:

     ```bash
     NETLIFY_DB_URL='<connection string>' npm run db:seed -- --editor <email> [--editor <email>]
     ```

   - Or `npm run db:seed -- --dry-run --editor <email>` and paste the SQL into the database
     console.
9. **Remove variables the old portal used:** `LIBRARIAN_GITHUB_TOKEN`, `LIBRARIAN_GITHUB_REPO`,
   `LIBRARIAN_GITHUB_BRANCH`, `LIBRARIAN_IDENTITY_URL`. Revoke that GitHub token. The Blobs store
   `librarians` can be deleted once step 8 is done.

## Keep Decap working

10. **Leave Git Gateway on:** Identity > Services > Git Gateway. Decap at `/web/admin/` signs in
    through it. If Git Gateway is restricted to a role, team members keep that role.
    - With registration open, any confirmed user could use Git Gateway unless it is restricted
      to a role, so restrict it to the team's role.
    - Team invite and password-reset emails now open `/web/librarian/login/`. Team members set
      their password there, then log in at `/web/admin/`.

## Check it

- **Log in:** open `/web/librarian/login/`, create an account and confirm the email. Registering
  a library should show it as "Waiting for approval".
- **Approve:** as an admin, `/web/librarian/` lists it. Approving starts a deploy (Deploys
  shows "Approve community library …"), after which `/web/communities/<slug>/` exists.
- **Edit and contact:** edit the library, add an editor, and send a message through its contact
  form.

## Later: Tier 2 Parquet hosting (not decided)

If Cloudflare R2 is chosen:

- **Bucket:** create one for the Parquet files from `pythonscripts/export_parquet.py` and give it
  public read access (r2.dev or a custom domain).
- **CORS policy:**
  - allowed origins: the site's origin
  - allowed methods: `GET`, `HEAD`
  - allowed headers: `Range`
  - exposed headers: `Content-Range`, `Content-Length`, `ETag`, `Accept-Ranges`
- **Upload and connect:** upload `<id>.parquet`, then set `PUBLIC_PARQUET_BASE_URL` (all deploy
  contexts) to the bucket's public URL and redeploy.
