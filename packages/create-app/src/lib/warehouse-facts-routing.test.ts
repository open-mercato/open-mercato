import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

test('warehouse requests resolve installed WMS facts before ownership design', () => {
  for (const source of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    const root = fs.readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8')
    assert.match(root, /product\/price\/stock\/inventory→catalog/)
    assert.match(root, /warehouse→wms/)
  }
})

test('resolved business ownership does not independently select architecture', () => {
  for (const source of ['agentic/shared/AGENTS.md.template', 'template/AGENTS.md']) {
    const root = fs.readFileSync(new URL(`../../${source}`, import.meta.url), 'utf8')
    assert.match(root, /Unresolved capability\/ownership\/field-vs-history choice; boundary, upgrade, override, or registry failure/)
    assert.match(root, /add architecture only when ownership is unresolved/)
    assert.match(root, /Scaffold module starter; publish\/link an app module/)
  }
  const scaffold = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/SKILL.md', import.meta.url), 'utf8')
  assert.match(scaffold, /Architecture-only plans follow the root’s `architecture` \+ `module-data` exception/)
})
