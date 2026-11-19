import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// #6850: docusaurus.config.ts still declared `url: 'https://docs.open-mercato.dev'`, a host that no
// longer resolves, so every sitemap.xml entry, canonical link and og:url pointed at a dead domain
// while the site is served from docs.openmercato.com. Docusaurus derives all three from `url`, so
// this pins it to the host the README and CONTRIBUTING.md link to, and keeps the retired host out
// of the files that ship docs links to users.
const canonicalOrigin = 'https://docs.openmercato.com';
const retiredHost = 'docs.open-mercato.dev';

const docusaurusConfigUrl = new URL('../docusaurus.config.ts', import.meta.url);
const readmeUrl = new URL('../../../README.md', import.meta.url);
const contributingUrl = new URL('../../../CONTRIBUTING.md', import.meta.url);

const filesLinkingToDocs = [
  docusaurusConfigUrl,
  readmeUrl,
  contributingUrl,
  new URL('../../mercato/.env.example', import.meta.url),
  new URL('../../../packages/create-app/template/.env.example', import.meta.url),
];

test('docs site url is the canonical docs.openmercato.com origin', async () => {
  const config = await readFile(docusaurusConfigUrl, 'utf8');
  const urlMatch = config.match(/^\s*url:\s*['"]([^'"]+)['"]/m);
  assert.ok(urlMatch, 'docusaurus.config.ts must declare a top-level `url`');
  assert.equal(urlMatch[1], canonicalOrigin);
});

test('README and CONTRIBUTING link to the same docs origin the site is built for', async () => {
  for (const fileUrl of [readmeUrl, contributingUrl]) {
    const content = await readFile(fileUrl, 'utf8');
    assert.ok(
      content.includes(`${canonicalOrigin}/`),
      `${fileUrl.pathname} must link to ${canonicalOrigin}; update the docs site url together with it`,
    );
  }
});

test('no shipped docs link points at the retired docs host', async () => {
  for (const fileUrl of filesLinkingToDocs) {
    const content = await readFile(fileUrl, 'utf8');
    assert.ok(!content.includes(retiredHost), `${fileUrl.pathname} still references ${retiredHost}`);
  }
});
