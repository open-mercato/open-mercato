import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (relative: string) => fs.readFileSync(new URL(`../../agentic/${relative}`, import.meta.url), 'utf8')

test('CRUD reference inspection reads its procedure owner before following example sources', () => {
  const scaffold = read('shared/ai/skills/om-module-scaffold/SKILL.md')
  assert.match(scaffold, /API\/schema\/command implementation, fix, or reference inspection MUST read/)
  assert.match(scaffold, /`\.ai\/guides\/contracts\.md` and `references\/api-and-domain\.md`/)
  assert.match(scaffold, /START at \[`src\/modules\/example\/README\.md`\]/)
  assert.ok(Buffer.byteLength(scaffold) <= 5_265)
})

test('source lookup defaults to the human index and keeps its exact machine-view exception bounded', () => {
  for (const name of ['om-module-scaffold', 'om-system-extension']) {
    const skill = read(`shared/ai/skills/${name}/SKILL.md`)
    assert.match(skill, /source lookup:.*\[`.*surface-map\.md`\]/)
    if (name === 'om-module-scaffold') {
      assert.match(skill, /surface-map\.md.*by default; if outside exact read permissions, use the already-authorized equivalent.*surface-inventory\.json/)
      assert.match(skill, /also for extra metadata; never both indexes/)
    } else assert.match(skill, /machine inventory only for additional metadata; never both indexes/)
    assert.ok(Buffer.byteLength(skill) <= (name === 'om-module-scaffold' ? 5_265 : 5_026))
  }
  assert.match(read('shared/ai/skills/om-system-extension/SKILL.md'), /Before following an example source link,/)
})

test('a rendered customer tab keeps installed-version fallback conditional and does not require app persistence', () => {
  const records = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{
    id: string
    frameworkContext?: unknown
    context: { allowedExtra: string[]; installedVersionFallback: unknown }
    requiredDecisions: string[]
  }>
  const record = records.find(record => record.id === 'OMH-203')
  assert.ok(record)
  assert.equal(record.frameworkContext, undefined)
  assert.deepEqual(record.context.installedVersionFallback, {
    allowed: true,
    reasonCodes: ['INSTALLED_VERSION_CONTRACT_MISMATCH'],
    maxFiles: 4,
    maxBytes: 65_536,
  })
  assert.ok(record.context.allowedExtra.includes('node_modules/@open-mercato/core/src/modules/customers/backend/customers/people-v2/[id]/page.tsx'))
  assert.ok(!record.requiredDecisions.includes('extension-entity'))
  for (const decision of ['extension-mechanism', 'additive-before-replacement', 'eject-last', 'person-detail-tab-spot', 'company-detail-tab-spot', 'installed-packages-read-only']) {
    assert.ok(record.requiredDecisions.includes(decision), decision)
  }
  const extension = read('shared/ai/skills/om-system-extension/SKILL.md')
  assert.match(extension, /When choosing one installed-host field versus extension records for history\/rules/)
  assert.match(extension, /`extension-mechanism`, `additive-before-replacement`, `extension-entity`, and `eject-last`/)
})


test('the library twins can follow the authorized equivalent index while canonical sources remain read-only', async () => {
  const scaffold = read('shared/ai/skills/om-module-scaffold/SKILL.md')
  assert.match(scaffold, /if outside exact read permissions, use the already-authorized equivalent/)
  const evaluator = await import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href)
  const records = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{
    id: string
    context: { exampleRoots?: Array<{ root: string }> }
    allowedWrites?: string[]
  }>
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-example-index-'))
  const example = 'src/modules/example'
  const human = `${example}/references/surface-map.md`
  const machine = `${example}/references/surface-inventory.json`
  const source = `${example}/data/entities.ts`
  try {
    fs.cpSync(new URL('../../template/src/modules/example/', import.meta.url), path.join(root, example), { recursive: true })
    for (const id of ['OMH-185', 'OMH-193']) {
      const record = records.find(record => record.id === id)
      assert.ok(record)
      const allowed = evaluator.caseReadAllowlist(record, true, root) as string[]
      assert.ok(allowed.includes(`${example}/README.md`), id)
      assert.ok(allowed.includes(machine), id)
      assert.ok(!allowed.includes(human), id)
      const trace = evaluator.evaluateExampleReadPolicy({ caseRecord: record, appRoot: root, reads: [
        { path: `${example}/README.md` }, { path: machine }, { path: source },
      ] })
      assert.equal(trace.firstViolation, null, id)
      assert.deepEqual(trace.roots[0].entrypoints, ['README.md'])
      assert.equal(trace.roots[0].files, 3)
      const original = fs.readFileSync(path.join(root, source), 'utf8')
      const calls = [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
        ...[
          { name: 'read', arguments: { path: machine } },
          { name: 'read', arguments: { path: source } },
          { name: 'read', arguments: { path: human } },
          { name: 'write', arguments: { path: source, content: 'tampered' } },
        ].map((call, index) => ({ jsonrpc: '2.0', id: index + 2, method: 'tools/call', params: call })),
      ]
      const server = spawnSync(process.execPath, [
        fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url)),
        root, 'writable', JSON.stringify(allowed), JSON.stringify(record.allowedWrites),
      ], { input: calls.map(call => JSON.stringify(call)).join('\n') + '\n', encoding: 'utf8', env: {} })
      assert.equal(server.status, 0, server.stderr)
      const replies = server.stdout.trim().split('\n').map(line => JSON.parse(line))
      assert.ok(replies[0].result.protocolVersion)
      assert.equal(replies[1].result.content[0].text, fs.readFileSync(path.join(root, machine), 'utf8'))
      assert.equal(replies[2].result.content[0].text, original)
      assert.equal(replies[3].result.isError, true)
      assert.equal(replies[4].result.isError, true)
      assert.equal(fs.readFileSync(path.join(root, source), 'utf8'), original)
    }
    const defaultCase = records.find(record => record.id === 'OMH-223')
    assert.ok(defaultCase)
    assert.ok(evaluator.caseReadAllowlist(defaultCase, true, root).includes(human))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('module-surface reference inspection reads its owner before canonical event sources', () => {
  const scaffold = read('shared/ai/skills/om-module-scaffold/SKILL.md')
  assert.match(scaffold, /Module-surface implementation\/reference inspection MUST first read `references\/module-surfaces\.md`/)
  assert.match(scaffold, /when the brief uses cache or queues, load `references\/runtime-cache-and-queues\.md`/)
  assert.ok(Buffer.byteLength(scaffold) <= 5_265)
  assert.match(read('shared/ai/skills/om-module-scaffold/references/module-surfaces.md'), /\[\`events\.ts\`\]/)
})

test('library command consistency reads its exact index and cache owners without inferring queued work', () => {
  const blueprint = read('shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md')
  const library = blueprint.slice(blueprint.indexOf('### Complete Library Contract'))
  assert.match(library, /For library command post-commit cache\/index and undo consistency, first read `\.ai\/guides\/modules\/query_index\/index\.md` and `references\/runtime-cache-and-queues\.md` Cache rules; do not infer queued work\./)
  for (const contract of ['emitCrudUndoSideEffects', 'enforceCommandOptimisticLock', 'withAtomicFlush', 'buildCustomFieldResetMap']) assert.ok(blueprint.includes(contract))
})

test('customer detail-tab guidance distinguishes installed person and company hosts before selecting one', () => {
  const guide = read('guides/extensions.md')
  assert.match(guide, /For Customers detail tabs, distinguish person and company hosts in installed facts/)
  assert.match(guide, /The example's person spot does not apply to companies; select only the requested exact host/)
  const table = fs.readFileSync(new URL('../../template/src/modules/example/widgets/injection-table.ts', import.meta.url), 'utf8')
  assert.ok(table.includes('customers.person.detail:details'))
  assert.ok(!table.includes('customers.company.detail:details'))
  assert.ok(Buffer.byteLength(guide) <= 12_718)
})

test('library contract planning reads shared helper authority and cross-module verification before writing', () => {
  const blueprint = read('shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md')
  const library = blueprint.slice(blueprint.indexOf('### Complete Library Contract'))
  assert.match(library, /During library contract selection\/reference planning, directly read `node_modules\/@open-mercato\/shared\/AGENTS\.md` for authoritative helpers and `\.ai\/skills\/om-system-extension\/references\/verification\.md` for cross-module proof/)
  assert.match(library, /Do not defer these reads until writing or after implementation\./)
  const api = read('shared/ai/skills/om-module-scaffold/references/api-and-domain.md')
  assert.match(api, /Before writing a route or command, read `node_modules\/@open-mercato\/shared\/AGENTS\.md`/)
})

test('onboarding reuses workflow-owned state and built-in mail without inventing schema or providers', () => {
  const blueprint = read('shared/ai/skills/om-module-scaffold/references/business-one-shot-blueprints.md')
  assert.match(blueprint, /add `om-data-model-design` for new app-owned business data\/schema or persisted fields, not already-owned workflow-engine state/)
  const onboarding = blueprint.split('\n').find(line => line.includes('Automate customer onboarding across sales, tasks, and email.'))
  assert.ok(onboarding)
  assert.match(onboarding, /`M\+W\+U\+B`/)
  assert.match(onboarding, /add `P` only for actual new provider\/transport\/mailbox work; built-in welcome\/invite helpers do not require integration/)
  for (const guard of ['idempotent steps', 'explicit compensation', 'no credentials in workflow state', 'missing optional provider yields actionable pause']) assert.ok(onboarding.includes(guard))
  assert.match(blueprint, /`M` — `om-module-scaffold` plus contracts/)
  assert.match(blueprint, /`P` — `om-integration-builder` plus the integrations guide for a reusable external provider/)
  const workflow = read('shared/ai/skills/om-build-workflow/SKILL.md')
  assert.match(workflow, /new app business persistence adds `module-data` \+ `om-data-model-design`/)
})

test('locating existing bulk-progress sources does not imply implementing UI or an installed-host extension', () => {
  const runtime = read('shared/ai/skills/om-module-scaffold/references/runtime-cache-and-queues.md')
  assert.match(runtime, /Source-selection-only requests for existing app-module bulk\/progress references stay `module-data`/)
  assert.match(runtime, /An unchanged widget filename alone does not require UI or UMES implementation procedures/)
  assert.match(runtime, /Actual rendered UI changes or installed-host integration still add their matching routes and guards/)
  for (const guard of ['Carry trusted `tenantId`', 'Enqueue only after commit', 'A handler must be idempotent', 'scope isolation']) assert.ok(runtime.includes(guard))
})

test('design reference navigation uses authorized canonical metadata without reading controller-private inventories', async () => {
  const guide = read('shared/ai/skills/om-backend-ui-design/references/frontend-and-design-system.md')
  assert.match(guide, /already-authorized canonical \[`surface-inventory\.json`\]/)
  assert.match(guide, /Do not expand read permissions to controller-private `\.ai\/harness\/` data/)
  assert.doesNotMatch(guide, /Start with the generated `\.ai\/harness\/design-system-inventory\.json`/)
  for (const source of [
    'node_modules/@open-mercato/core/src/modules/design_system/gallery/entries/buttons.tsx',
    'node_modules/@open-mercato/ui/src/primitives/button.tsx',
    'node_modules/@open-mercato/ui/figma/button.figma.tsx',
    'src/app/globals.css',
  ]) assert.ok(guide.includes(`../../../../${source}`), source)
  for (const guard of ['not a package export or runtime dependency', 'grants no access to the rest of `figma/`', 'do not substitute a monorepo-only skill/snapshot', 'infer Figma publication from parse success', 'network/credential paths']) assert.ok(guide.includes(guard), guard)
  const evaluator = await import(new URL('../../agentic/shared/scripts/evaluate-agent-harness.mjs', import.meta.url).href)
  const records = JSON.parse(read('shared/ai/harness/cases.json')) as Array<{ id: string; allowedWrites: string[] }>
  const record = records.find(record => record.id === 'OMH-223')
  assert.ok(record)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-design-reference-'))
  const inventory = 'src/modules/example/references/surface-inventory.json'
  const controller = '.ai/harness/design-system-inventory.json'
  try {
    fs.cpSync(new URL('../../template/src/modules/example/', import.meta.url), path.join(root, 'src/modules/example'), { recursive: true })
    fs.mkdirSync(path.dirname(path.join(root, controller)), { recursive: true })
    fs.writeFileSync(path.join(root, controller), '{}')
    const metadata = JSON.parse(fs.readFileSync(path.join(root, inventory), 'utf8'))
    assert.ok(metadata.designSystemReferences.some((reference: { galleryItemIds: string[] }) => reference.galleryItemIds.includes('buttons/button')))
    assert.equal(metadata.designFoundation.codeConnectArtifactAvailability, 'installed-packed-auxiliary')
    assert.equal(metadata.designFoundation.publicationStatus, 'not-evidenced')
    const allowed = evaluator.caseReadAllowlist(record, true, root)
    assert.ok(allowed.includes(inventory))
    assert.ok(!allowed.includes(controller))
    const messages = [inventory, controller].map((file, index) => ({
      jsonrpc: '2.0', id: index + 1, method: 'tools/call', params: { name: 'read', arguments: { path: file } },
    }))
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../../agentic/shared/scripts/agent-harness-tool-server.mjs', import.meta.url)),
      root, 'writable', JSON.stringify(allowed), JSON.stringify(record.allowedWrites),
    ], { input: messages.map(message => JSON.stringify(message)).join('\n') + '\n', encoding: 'utf8', env: {} })
    assert.equal(result.status, 0, result.stderr)
    const replies = result.stdout.trim().split('\n').map(line => JSON.parse(line))
    assert.equal(replies[0].result.content[0].text, fs.readFileSync(path.join(root, inventory), 'utf8'))
    assert.equal(replies[1].result.isError, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
