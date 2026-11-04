import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const read = (relative: string): string => fs.readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8')

test('standalone app template tooling has one routed guide for saving and creating app templates', () => {
  const guidePath = new URL('../../agentic/guides/template-tool.md', import.meta.url)
  const guide = fs.existsSync(guidePath) ? fs.readFileSync(guidePath, 'utf8') : ''
  const save = [...guide.matchAll(/^npx create-mercato-template (.+)$/gm)].map((match) => match[1])
  assert.ok(save.includes('prepare --out ../my-template'), 'missing the snapshot command')
  assert.ok(
    save.some((command) => /^publish --from \.\.\/my-template --repo \S+ --(?:public|private) --expect <snapshotId>$/.test(command)),
    'missing the publication command bound to a reviewed snapshot',
  )
  assert.ok(save.includes('describe --from ../my-template'), 'missing the catalog entry command')
  const create = [...guide.matchAll(/^npx create-mercato-app (.+)$/gm)].map((match) => match[1])
  assert.ok(create.some((command) => /^\S+ --template [\w-]+\/[\w.-]+$/.test(command)), 'missing --template owner/repo')
  assert.ok(create.some((command) => /^\S+ --template [a-z0-9-]+$/.test(command)), 'missing --template <slug>')

  assert.match(guide, /code only/i)
  assert.match(guide, /database.*uploads.*`\.env` files/is)
  assert.match(guide, /images are not scanned/i)
  assert.match(guide, /never choose it for the user/i)
  assert.match(guide, /never force-pushes/i)
  assert.match(guide, /--resume/)
  assert.match(guide, /GITHUB_TOKEN/)
  assert.match(guide, /refuses a template on hold/i)
  assert.match(guide, /--keep-name/)
  assert.match(guide, /openMercatoTemplate/)
  assert.match(guide, /Without process execution, report that capability gap/)
  assert.doesNotMatch(guide, /[–—]/, 'no long dashes')

  for (const root of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    assert.match(read(root), /Save this app as an app template, or create an app from one.*template-tool\.md/i)
  }
  assert.match(read('agentic/guides/architecture.md'), /\.ai\/guides\/template-tool\.md/)
})
