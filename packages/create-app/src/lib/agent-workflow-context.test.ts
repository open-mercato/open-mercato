import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const workflowSkillUrl = new URL('../../agentic/shared/ai/skills/om-build-workflow/SKILL.md', import.meta.url)

test('workflow lookup uses supplied contracts before a named exact-version source gap', () => {
  const skill = fs.readFileSync(workflowSkillUrl, 'utf8')
  const lookup = skill.split('\n').find((line) => line.startsWith('1. '))
  assert.ok(lookup)
  assert.match(lookup, /supplied workflow facts\/contracts first/)
  assert.match(lookup, /`om-framework-context` only for a named unresolved exact-version symbol/)
  assert.doesNotMatch(lookup, /use `om-framework-context` for exact service\/activity contracts/)
})

test('engine activity state stays workflow-only while new business persistence still loads modeling', () => {
  const skill = fs.readFileSync(workflowSkillUrl, 'utf8')
  const routing = skill.split('\n').find((line) => line.startsWith('Route before reading:'))
  assert.ok(routing)
  assert.match(routing, /engine definitions\/activities\/state\/idempotency\/tasks\/outputs stay `ai-workflow`/)
  assert.match(routing, /new app business persistence adds `module-data` \+ `om-data-model-design`/)
  assert.match(routing, /Workflow-only: `\.ai\/guides\/modules\/workflows\/index\.md`, not contracts/)
  assert.match(routing, /installed-host order, status, or quantity state also selects `module-data` \+ `umes`/)
  assert.match(routing, /loads `\.ai\/guides\/contracts\.md`, `\.ai\/guides\/extensions\.md`, and `om-system-extension`/)
  const guide = fs.readFileSync(new URL('../../agentic/guides/ai-workflows.md', import.meta.url), 'utf8')
  assert.match(guide, /Create any one-time\/idempotency key outside a rollback scope or in durable state that survives rollback; reuse it on retry/)
  assert.match(guide, /Organization-owned instances, tasks, activity state, and queries require tenant\+organization and fail closed/)
})

test('root modeling routes require business-record design rather than existing workflow helper use', () => {
  const roots = [
    { url: new URL('../../agentic/shared/AGENTS.md.template', import.meta.url), maximumBytes: 11_233 },
    { url: new URL('../../template/AGENTS.md', import.meta.url), maximumBytes: 11_229 },
  ]
  for (const root of roots) {
    const text = fs.readFileSync(root.url, 'utf8')
    const modeling = text.split('\n').find(line => line.includes('`om-data-model-design` + contracts'))
    assert.ok(modeling)
    assert.match(modeling, /Business-record design: entity\/link\/validator\/migration\/encryption\/lock\/transaction/)
    assert.match(modeling, /not helper reuse\/provider metadata/)
    assert.match(text, /Durable process\/activity\/user task = `ai-workflow`; app business persistence\/host-state coordination adds `module-data`/)
    assert.doesNotMatch(text, /Durable process\/activity\/user task = `module-data` \+ `ai-workflow`/)
    assert.match(text, /Installed-host custom fields\/entities = `umes` \+ `module-data` \+ `om-data-model-design`/)
    assert.match(text, /scalar-ID\/snapshot fix to persisted records or commands linked to an installed record MUST use `module-data` \+ `umes`/)
    assert.match(text, /Multi-stage waits\/cancel\/restart are durable; reminders and renewal\/batch schedules are `module-data`/)
    assert.match(text, /Editable records expose `updated_at`\/`updatedAt`; custom update\/delete clients send the version and surface 409s/)
    assert.match(text, /Put entities in `src\/modules\/<id>\/data\/entities\.ts`/)
    assert.ok(Buffer.byteLength(text) <= root.maximumBytes)
  }
})
