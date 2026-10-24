import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const skill = () => fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-troubleshooter/SKILL.md', import.meta.url), 'utf8')

test('query-scope repairs load domain contracts before reaching a store', () => {
  assert.match(skill(), /Query-scope repairs also select `module-data` and contracts/)
  assert.match(skill(), /missing tenant or organization must fail before any query \(`no-unscoped-query`\)/)
  assert.match(skill(), /Null scope fails closed unless the path is explicitly designed and tested as global/)
})

test('seeded public-seam repairs explicitly read and preserve the compatibility contract', () => {
  assert.match(skill(), /read `\.ai\/guides\/upstream\/BACKWARD_COMPATIBILITY\.md` when repairing a seeded export or public seam; preserve that seam/)
  assert.match(skill(), /Preserve behavior outside the proven defect/)
})
