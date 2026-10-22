import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const roots = [
  new URL('../../agentic/shared/AGENTS.md.template', import.meta.url),
  new URL('../../template/AGENTS.md', import.meta.url),
]

test('root work units keep provider metadata with its integration owner', () => {
  for (const root of roots) {
    const text = fs.readFileSync(root, 'utf8')
    const modeling = text.split('\n').find(line => line.includes('`om-data-model-design` + contracts'))
    assert.ok(modeling)
    assert.match(modeling, /App-owned record design: entity\/link\/validator\/migration\/encryption\/lock\/transaction; not helper reuse\/provider metadata/)
    assert.match(text, /\| `integration` \| Provider\/credentials\/health\/webhook\/files\/client\/reconciliation\/package \| `om-integration-builder` \+ integrations \|/)
  }
  const integration = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-integration-builder/SKILL.md', import.meta.url), 'utf8')
  assert.match(integration, /Provider credentials, mappings, external IDs, and cursors stay in this skill; do not add `om-data-model-design` unless the brief also creates a separate business-domain schema/)
  assert.match(integration, /encrypted credentials, per-user scope, SSRF, redaction, signature\/replay/)
})
