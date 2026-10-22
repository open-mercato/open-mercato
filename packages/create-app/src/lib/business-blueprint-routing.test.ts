import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const blueprints = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md', import.meta.url), 'utf8')

test('owned app-module blueprints load architecture only for unresolved ownership', () => {
  const moduleKey = blueprints.split('\n').find(line => line.startsWith('- `M` —'))
  assert.ok(moduleKey)
  assert.match(moduleKey, /`om-module-scaffold` plus contracts; architecture only for unresolved ownership/)
  assert.match(moduleKey, /add `om-data-model-design` when persisting records/)
  const scaffold = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/SKILL.md', import.meta.url), 'utf8')
  assert.match(scaffold, /Architecture-only plans follow the root’s `architecture` \+ `module-data` exception/)
  assert.match(scaffold, /Read `\.ai\/guides\/architecture\.md` and `references\/planning\.md` only for unresolved ownership/)
})

test('forecast drill-down tables publish stable extension IDs alongside aggregate safety', () => {
  const forecast = blueprints.split('\n').find(line => line.startsWith('| “Build a sales forecast and pipeline coaching dashboard.”'))
  assert.ok(forecast)
  assert.match(forecast, /stable table-host, column, and action IDs/)
  assert.match(forecast, /scoped forecast query, stage-weighted totals, owner\/time filters, drill-down, snapshot\/export/)
  assert.match(forecast, /currency\/time-zone correctness; access-filtered aggregates; deterministic totals; no cross-tenant cache keys/)
})
