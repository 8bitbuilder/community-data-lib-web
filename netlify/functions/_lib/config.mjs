export function loadConfig(env = process.env) {
  for (const name of ['AUTH_SECRET', 'EDITOR_EMAILS', 'SITE_ORIGIN']) {
    if (!env[name]) throw new Error(`Missing environment variable ${name}`);
  }
  if (env.AUTH_SECRET.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters');
  return {
    authSecret: env.AUTH_SECRET,
    editorEmails: env.EDITOR_EMAILS,
    siteOrigin: env.SITE_ORIGIN.replace(/\/+$/, ''),
    resendApiKey: env.RESEND_API_KEY,
    mailFrom: env.MAIL_FROM,
    githubToken: env.GITHUB_TOKEN,
    githubRepo: env.GITHUB_REPO || 'community-data-libraries/backend',
    previewPath: '/web/data-preview',
  };
}
