import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  librarySlugForHost,
  libraryUrl,
  mainSiteUrl,
  normalizeDomain,
  normalizeOrigin,
  routeLibraryRequest,
} from '../src/lib/community/libraryHosts.mjs';

const settings = { libraryDomain: 'communitydatalibraries.org', mainSiteUrl: 'https://communitydatalibraries.org' };
const route = (href: string, options: object = settings) => routeLibraryRequest(new URL(href), options);

test('settings are normalized', () => {
  assert.equal(normalizeDomain(' https://*.CommunityDataLibraries.org/ '), 'communitydatalibraries.org');
  assert.equal(normalizeDomain(''), null);
  assert.equal(normalizeDomain(undefined), null);
  assert.equal(normalizeOrigin('https://communitydatalibraries.org/web/'), 'https://communitydatalibraries.org');
  assert.equal(normalizeOrigin('not a url'), null);
  assert.equal(normalizeOrigin(''), null);
});

test('a library subdomain names its slug; other hosts do not', () => {
  const domain = 'communitydatalibraries.org';
  assert.equal(librarySlugForHost('knox-county.communitydatalibraries.org', domain), 'knox-county');
  assert.equal(librarySlugForHost('Knox-County.CommunityDataLibraries.org.', domain), 'knox-county');
  assert.equal(librarySlugForHost('communitydatalibraries.org', domain), null);
  assert.equal(librarySlugForHost('www.communitydatalibraries.org', domain), null);
  assert.equal(librarySlugForHost('a.b.communitydatalibraries.org', domain), null);
  assert.equal(librarySlugForHost('knox-county.example.org', domain), null);
  assert.equal(librarySlugForHost('evilcommunitydatalibraries.org', domain), null);
  assert.equal(librarySlugForHost('knox-county.communitydatalibraries.org', undefined), null);
});

test('library and main-site links follow the settings', () => {
  assert.equal(libraryUrl('knox-county', '/', { basePath: '/web' }), '/web/communities/knox-county/');
  assert.equal(libraryUrl('knox-county', '/catalog/', { basePath: '/web/' }), '/web/communities/knox-county/catalog/');
  assert.equal(libraryUrl('knox-county', '/', { ...settings, basePath: '/web' }), 'https://knox-county.communitydatalibraries.org/');
  assert.equal(
    libraryUrl('knox-county', 'catalog/', { ...settings, basePath: '/web' }),
    'https://knox-county.communitydatalibraries.org/catalog/',
  );

  assert.equal(mainSiteUrl('/', { basePath: '/web' }), '/web/');
  assert.equal(mainSiteUrl('/submit', { basePath: '/web/' }), '/web/submit');
  assert.equal(mainSiteUrl('/', { ...settings, basePath: '/web' }), 'https://communitydatalibraries.org/web/');
  assert.equal(mainSiteUrl('/data-preview?source=x', { ...settings, basePath: '/web' }), 'https://communitydatalibraries.org/web/data-preview?source=x');
});

test('without a library domain the edge function does nothing', () => {
  assert.equal(route('https://knox-county.communitydatalibraries.org/', {}), null);
  assert.equal(route('https://communitydatalibraries.org/web/communities/knox-county/', { libraryDomain: '' }), null);
});

test('library pages are rewritten to the library, keeping the query', () => {
  assert.deepEqual(route('https://knox-county.communitydatalibraries.org/'), { rewrite: '/communities/knox-county/', slug: 'knox-county' });
  assert.deepEqual(route('https://knox-county.communitydatalibraries.org/catalog/?audience=teacher'), {
    rewrite: '/communities/knox-county/catalog/?audience=teacher',
    slug: 'knox-county',
  });
  // Unknown slugs rewrite too; the edge function checks the slug and answers 404.
  assert.deepEqual(route('https://nowhere.communitydatalibraries.org/'), { rewrite: '/communities/nowhere/', slug: 'nowhere' });
});

test('library pages get a trailing slash, so the address keeps the subdomain', () => {
  assert.deepEqual(route('https://knox-county.communitydatalibraries.org/catalog?audience=student'), {
    redirect: 'https://knox-county.communitydatalibraries.org/catalog/?audience=student',
  });
});

test('assets, functions and already-rewritten paths pass through on a library subdomain', () => {
  for (const path of [
    '/web/_astro/index.abc123.css',
    '/web/favicon.svg',
    '/web/api/community.json',
    '/api/library-contact',
    '/.netlify/functions/library-contact',
    '/favicon.ico',
    '/communities/knox-county/',
    '/communities/knox-county/catalog/',
  ]) {
    assert.equal(route(`https://knox-county.communitydatalibraries.org${path}`), null, path);
  }
});

test('main-site pages on a library subdomain go to the main site', () => {
  assert.deepEqual(route('https://knox-county.communitydatalibraries.org/web/data-resources'), {
    redirect: 'https://communitydatalibraries.org/web/data-resources',
  });
  assert.deepEqual(route('https://knox-county.communitydatalibraries.org/web'), {
    redirect: 'https://communitydatalibraries.org/web',
  });
  // Without a main-site address there is nowhere to send them: serve them here.
  assert.equal(route('https://knox-county.communitydatalibraries.org/web/submit', { libraryDomain: 'communitydatalibraries.org' }), null);
});

test('old library addresses on the main site move to the subdomain', () => {
  assert.deepEqual(route('https://communitydatalibraries.org/web/communities/knox-county/catalog/?audience=teacher'), {
    redirect: 'https://knox-county.communitydatalibraries.org/catalog/?audience=teacher',
  });
  assert.deepEqual(route('https://www.communitydatalibraries.org/web/communities/knox-county'), {
    redirect: 'https://knox-county.communitydatalibraries.org/',
  });
  assert.equal(route('https://communitydatalibraries.org/web/communities/www/'), null);
  assert.equal(route('https://communitydatalibraries.org/web/complete-catalog'), null);
  assert.equal(route('https://communitydatalibraries.org/'), null);
});

test('other hosts (netlify.app, deploy previews) pass through', () => {
  assert.equal(route('https://cdl.netlify.app/web/communities/knox-county/'), null);
  assert.equal(route('https://deploy-preview-3--cdl.netlify.app/'), null);
});

test('a main site on another host also redirects old addresses', () => {
  const other = { libraryDomain: 'communitydatalibraries.org', mainSiteUrl: 'https://cdl.netlify.app' };
  assert.deepEqual(route('https://cdl.netlify.app/web/communities/knox-county/', other), {
    redirect: 'https://knox-county.communitydatalibraries.org/',
  });
});
