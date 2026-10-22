import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const blueprints = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md', import.meta.url), 'utf8')

test('owned app-module blueprints load architecture only for unresolved ownership', () => {
  const moduleKey = blueprints.split('\n').find(line => line.startsWith('- `M` —'))
  assert.ok(moduleKey)
  assert.match(moduleKey, /`om-module-scaffold` plus contracts; architecture only for unresolved ownership/)
  assert.match(moduleKey, /add `om-data-model-design` for new app-owned business data\/schema or persisted fields, not already-owned workflow-engine state/)
  const scaffold = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/SKILL.md', import.meta.url), 'utf8')
  assert.match(scaffold, /Ownership\/capability-only outlines: first read `\.ai\/guides\/architecture\.md` \+ `references\/discovery-surface-catalog\.md`/)
  assert.match(scaffold, /Only unresolved implementation ownership adds reads of `\.ai\/guides\/architecture\.md` and `references\/planning\.md`/)
})

test('complete capability maps load architecture without escalating routine discovery or specialist implementation', () => {
  const catalog = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/references/discovery-surface-catalog.md', import.meta.url), 'utf8')
  assert.match(catalog, /Complete module capability\/ownership maps read `\.ai\/guides\/architecture\.md`/)
  assert.match(catalog, /use the architecture-only planning exception; name specialist ownership without loading implementation procedures/)
  assert.match(catalog, /Explicit AI contract selection still loads its AI guide\/skill; a single known surface stays in its owning area/)
  const root = fs.readFileSync(new URL('../../agentic/shared/AGENTS.md.template', import.meta.url), 'utf8')
  assert.match(root, /ownership\/capability outline adds `architecture`/)
  assert.match(root, /routine discovery stays in its area/)
})

test('forecast drill-down tables publish stable extension IDs alongside aggregate safety', () => {
  const forecast = blueprints.split('\n').find(line => line.startsWith('| “Build a sales forecast and pipeline coaching dashboard.”'))
  assert.ok(forecast)
  assert.match(forecast, /stable table-host, column, and action IDs/)
  assert.match(forecast, /scoped forecast query, stage-weighted totals, owner\/time filters, drill-down, snapshot\/export/)
  assert.match(forecast, /currency\/time-zone correctness; access-filtered aggregates; deterministic totals; no cross-tenant cache keys/)
})

test('only an authorized specification-only deliverable defers module implementation procedures', () => {
  const scaffold = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/SKILL.md', import.meta.url), 'utf8')
  const phase = scaffold.split('\n').find(line => /Only user-authorized specification-only deliverables/.test(line))
  assert.ok(phase, 'The phase exception must require the user-authorized deliverable, not read-only evaluation')
  assert.match(phase, /ground plans in requested reference owners\/facts/)
  assert.match(phase, /implementation procedures await implementation authorization/)
  assert.ok(scaffold.indexOf(phase) < scaffold.indexOf('Complete one-shot modules/CRUD slices MUST'))
  assert.match(scaffold, /Complete one-shot modules\/CRUD slices MUST directly read exact step 3\/4\/7 paths before writing/)
  for (const reference of ['api-and-domain.md', 'module-surfaces.md', 'verification.md']) {
    assert.ok(scaffold.includes(`.ai/skills/om-module-scaffold/references/${reference}`))
  }
  assert.match(blueprints, /At library contract selection\/reference planning, directly read `node_modules\/@open-mercato\/shared\/AGENTS\.md`/)
  assert.match(blueprints, /`\.ai\/skills\/om-system-extension\/references\/verification\.md` for cross-module proof\. Read both before writing or implementation\./)
})
