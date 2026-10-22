import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

test('the emitted specification index links every shipped covering specification for exact-path readers', () => {
  const directory = fileURLToPath(new URL('../../agentic/shared/ai/specs/', import.meta.url))
  const index = fs.readFileSync(path.join(directory, 'README.md'), 'utf8')
  const specifications = fs.readdirSync(directory).filter(file => /^\d{4}-\d{2}-\d{2}-.+\.md$/.test(file)).sort()
  assert.ok(specifications.length > 0)
  const links = [...index.matchAll(/\[[^\]]+\]\(\.\/([^()\s]+\.md)\)/g)].map(match => match[1])
  assert.deepEqual(links.filter(file => /^\d{4}-\d{2}-\d{2}-/.test(file)).sort(), specifications)
  for (const file of specifications) {
    assert.match(fs.readFileSync(path.join(directory, file), 'utf8'), /^# .+/m)
  }
})

test('read-only spec routing reads its index and exact covering file through bounded filename lookup', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /Read `\.ai\/specs\/README\.md` first, then follow its matching specification links/)
  assert.match(guide, /use bounded metadata\/filename lookup/)
  assert.match(guide, /an exact-path reader follows the index instead of guessing filenames/)
  assert.match(guide, /Never read a directory as content or report its listing in `selectedContext`/)
  assert.match(guide, /If a covering file matches, read that exact file and choose `reuse-spec` before considering a new specification/)
  assert.match(guide, /A read-only planning decision stops after classification; do not author or amend a file/)
  assert.match(guide, /plus any enterprise directory the config names/)
  assert.match(guide, /Never open a second spec for the same capability/)
  assert.match(guide, /A bug fix, minor behavioral correction, small documentation change, dependency maintenance, or an isolated refactor/)
  assert.match(guide, /the user's current request explicitly says to skip or bypass it/)
  assert.match(guide, /When the classification is genuinely ambiguous/)
})

test('spec implementation delegates exact example navigation to its scaffold owner', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /module work loads `om-module-scaffold`, which owns canonical-example navigation and exact capability-linked source adaptation/)
  assert.doesNotMatch(guide, /starts at `src\/modules\/example\/README\.md` and its `references\/surface-inventory\.json`/)
  assert.match(guide, /Never propose a second teaching module, copy the example tree wholesale, or treat `ratelimit_probe` as a blueprint/)
})

test('the CRM tab request explicitly covers both hosts without treating the local person example as company evidence', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
    id: string
    prompt: string
    requiredDecisions: string[]
    context: { required: string[]; allowedExtra: string[] }
  }>
  const record = cases.find(record => record.id === 'OMH-203')
  assert.ok(record)
  assert.match(record.prompt, /both person and company customer detail pages/)
  assert.match(record.prompt, /identify its declared person-detail target only/)
  assert.match(record.prompt, /Resolve the separate company host from the required installed customers facts/)
  assert.match(record.prompt, /If the exact installed person contract differs/)
  assert.ok(record.context.required.includes('.ai/guides/modules/customers/index.md'))
  assert.deepEqual(record.context.allowedExtra.filter(file => file.startsWith('node_modules/')), [
    'node_modules/@open-mercato/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx',
  ])
  for (const decision of ['person-detail-tab-spot', 'company-detail-tab-spot']) assert.ok(record.requiredDecisions.includes(decision))
  const local = fs.readFileSync(new URL('../../template/src/modules/example/widgets/injection-table.ts', import.meta.url), 'utf8')
  assert.ok(local.includes('customers.person.detail:details'))
  assert.ok(!local.includes('customers.company.detail:details'))
})

test('activating inactive shipped modules adds an app capability while retaining covering-spec reuse', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(guide, /Activating shipped but inactive modules for users adds a new app-visible capability even when their source already exists/)
  assert.match(guide, /reuse its covering specification rather than treating activation as maintenance or writing a duplicate/)
  assert.doesNotMatch(guide, /OMH-\d{3}|NEW_CAPABILITY|COVERING_SPEC_FOUND/)
  assert.match(guide, /A covering spec already exists: implement against it and update it in place/)
  const covering = fs.readFileSync(new URL('../../agentic/shared/ai/specs/2026-08-06-reference-module-activation.md', import.meta.url), 'utf8')
  assert.match(covering, /source-present and runtime-absent/)
  assert.match(covering, /routes, navigation entries, migrations, seeds, ACL features, workers, and search indexes/)
})
