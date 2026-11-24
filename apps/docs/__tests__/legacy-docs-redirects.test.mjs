import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { findRedirect } from '../legacy-docs.cjs'

const { redirects } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url)))
const legacyHost = 'docs.openmercato.com'
const newHost = 'https://www.openmercato.com'
const entryRoutes = new Map([
  ['/', '/documentation'],
  ['/search', '/documentation'],
  ['/introduction/overview', '/docs/platform-overview'],
])

test('each source in the migration has a distinct rule', () => {
  assert.equal(redirects.length, 296)
  assert.equal(new Set(redirects.map(({ source }) => source)).size, redirects.length)
})

for (const rule of redirects) {
  const path = rule.source.replace(/\{\/\}\?$/, '')
  test(path, () => {
    const target = newHost + (entryRoutes.get(path) ?? '/docs/' + path.slice(1).replaceAll('/', '-'))
    assert.equal(rule.destination, target)
    assert.equal(rule.permanent, true)
    assert.deepEqual(rule.has, [{ type: 'host', value: legacyHost }])
    if (path !== '/') assert.equal(rule.source, path + '{/}?')
    if (!['/', '/search'].includes(path)) {
      const base = new URL('../docs' + path, import.meta.url)
      assert.ok(['.md', '.mdx', '/index.md', '/index.mdx'].some((suffix) => existsSync(new URL(base.href + suffix))))
    }
    assert.equal(findRedirect(legacyHost, path), target)
    if (path !== '/') assert.equal(findRedirect(legacyHost, path + '/'), target)
    assert.equal(findRedirect(legacyHost, path + '?q=tools%20and%20APIs&q=more'), target + '?q=tools%20and%20APIs&q=more')
    assert.equal(findRedirect('docs.example.org', path), null)
  })
}

test('static media, health probes, build assets and unknown routes stay on the original host', () => {
  for (const path of ['/img/open-mercato.svg', '/screenshots/open-mercato-action-logs.png', '/assets/js/main.js', '/sitemap.xml', '/robots.txt', '/api/unknown']) {
    assert.equal(findRedirect(legacyHost, path), null)
  }
})
