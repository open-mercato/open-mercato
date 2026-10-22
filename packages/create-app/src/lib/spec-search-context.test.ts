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

test('the shipped activation specification covers activation without claiming unrelated reference-grounded business features', () => {
  const covering = fs.readFileSync(new URL('../../agentic/shared/ai/specs/2026-08-06-reference-module-activation.md', import.meta.url), 'utf8')
  const index = fs.readFileSync(new URL('../../agentic/shared/ai/specs/README.md', import.meta.url), 'utf8')
  const gate = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  assert.match(covering, /Requests to enable the Todo demo or expose the design-system gallery are covered here — amend this file/)
  assert.match(covering, /An unrelated new business feature needs its own covering specification even when it reuses either reference module/)
  assert.match(covering, /New app-owned business features are outside this activation scope/)
  assert.match(covering, /\| App-owned feature using a reference \| separate covering specification \|/)
  assert.doesNotMatch(covering, /first app capability on top of either one are covered here|enable either reference module, or build on it/)
  assert.match(index, /enabling the source-present Todo example and component gallery, feature grants, and migration consequences/)
  assert.match(gate, /If a covering file matches, read that exact file and choose `reuse-spec`/)
  assert.match(gate, /Never open a second spec for the same capability/)
})

test('reference-grounded specifications discover the emitted local facts without guessing installed-module paths', () => {
  const scaffold = fs.readFileSync(new URL('../../agentic/shared/ai/skills/om-module-scaffold/SKILL.md', import.meta.url), 'utf8')
  const referenceIndex = '.ai/guides/reference-modules/example/index.md'
  assert.ok(scaffold.includes(`\`${referenceIndex}\``))
  assert.match(scaffold, /generated local reference/)
  assert.match(scaffold, /task-matching section links/)
  assert.match(scaffold, /never guess installed-module fact paths/)
  const cases = JSON.parse(fs.readFileSync(new URL('../../agentic/shared/ai/harness/cases.json', import.meta.url), 'utf8')) as Array<{
    id: string
    requiredDecisions: string[]
    context: { required: string[]; allowedExtra: string[] }
  }>
  const planning = cases.filter(record => record.requiredDecisions.includes('generated-topology-identities'))
  assert.ok(planning.some(record => record.id === 'OMH-223'))
  for (const record of planning) {
    assert.ok([...record.context.required, ...record.context.allowedExtra].includes(referenceIndex), record.id)
    assert.ok(![...record.context.required, ...record.context.allowedExtra].includes('.ai/guides/modules/example/index.md'), record.id)
  }
})


test('the shipped spec template exposes substantive planning and separate extension traceability contracts', () => {
  const template = fs.readFileSync(new URL('../../agentic/shared/ai/specs/SPEC-000-template.md', import.meta.url), 'utf8')
  assert.match(template, /Harness-evaluated plans need 80 words each in Problem Statement, API\/Command\/Error Contracts, and Implementation Phases, and 40 in Integration Coverage/)
  const phases = template.split('## Implementation Phases\n')[1]?.split('## Requirement Traceability\n')[0]
  assert.ok(phases)
  assert.match(phases, /Route module work to `om-module-scaffold` inside this section/)
  assert.match(phases, /### Phase 1/)
  assert.match(phases, /### Phase 2/)
  const traceability = template.split('## Requirement Traceability\n')[1]?.split('## Rollout, Migration, and Rollback\n')[0]
  assert.ok(traceability)
  assert.match(traceability, /\| Requirement \| Journey \/ surface \| Data\/API\/event contracts \| Phase \| Tests \| Acceptance criterion \|/)
  assert.match(traceability, /### Extension Surface Traceability/)
  assert.match(traceability, /Reuse declared goal IDs; order rows by landing phase/)
  assert.match(traceability, /Keep each identity family in one row, including exact capability\/source\/fact\/topology IDs/)
  assert.match(traceability, /`Phase N`, `TEST-NNN` or an exact integration-test path/)
  assert.match(traceability, /one mechanism classification per row/)
  assert.match(traceability, /\| Requirement \| Extension surface \| Adapted from \| Phase \| Test \| Mechanism \|/)
  assert.doesNotMatch(template, /OMH-\d{3}|contiguous requirement IDs|unique.*REQ.*surface/i)
})


test('extension mechanism planning locates the canonical ledger without guessing another file', () => {
  const guide = fs.readFileSync(new URL('../../agentic/guides/spec-delivery.md', import.meta.url), 'utf8')
  const inventory = JSON.parse(fs.readFileSync(new URL('../../template/src/modules/example/references/surface-inventory.json', import.meta.url), 'utf8')) as { factCoverage?: unknown }
  assert.ok(inventory.factCoverage && typeof inventory.factCoverage === 'object' && !Array.isArray(inventory.factCoverage))
  assert.match(guide, /Only `references\/surface-inventory\.json`'s `factCoverage` justifies the last four; `negative-fixture` can never ship/)
  assert.doesNotMatch(guide, /references\/(?:coverage-ledger|surface-coverage)\.md/)
  for (const classification of ['emitted-example', 'framework-only', 'catalog-only', 'currently-unbound', 'negative-fixture']) {
    assert.ok(guide.includes(`\`${classification}\``))
  }
})
