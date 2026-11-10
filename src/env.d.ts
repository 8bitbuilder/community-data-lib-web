/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** e.g. "communitydatalibraries.org": serve libraries at <slug>.<domain> (web#31). */
  readonly PUBLIC_LIBRARY_DOMAIN?: string;
  /** e.g. "https://communitydatalibraries.org": where library pages link to the main site. */
  readonly PUBLIC_MAIN_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
