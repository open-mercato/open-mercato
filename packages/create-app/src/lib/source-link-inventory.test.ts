import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = fileURLToPath(new URL('../../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const generatorPath = path.join(packageRoot, 'scripts/generate-source-link-inventory.mjs')
const knowledgeValidatorPath = path.join(packageRoot, 'agentic/shared/scripts/validate-knowledge-change.mjs')

type Record_ = {
  topicId: string
  requirement: string
  originAsset: string
  originAuthoringPath: string | null
  heading: string | null
  targetKind: string
  readStatus: string
  resolvedPath: string
  targetAuthoringPath: string | null
  moduleId: string | null
  capabilityIds: string[]
  integrationTestPaths: string[]
  affectedCaseIds: string[]
  replacesBaselineBlockIds: string[]
  citedByBaselineBlockIds: string[]
  href?: string
  renderedLinkCount?: number
  evidence?: string
}

type Inventory = {
  version: number
  generatedNote: string
  inputs: Record<string, string>
  derived: {
    ownerCount: number
    recordCount: number
    sourceRequiredCount: number
    renderedLinkCount: number
    baselineSha: string | null
  }
  notCovered: string[]
  records: Record_[]
}

type BuildInput = {
  packageRoot: string
  registry: unknown
  baseline: unknown
  surfaceInventory: unknown
  cases: unknown
}

type Generator = {
  INVENTORY_RELATIVE_PATH: string
  TOPICS_RELATIVE_PATH: string
  BASELINE_RELATIVE_PATH: string
  SURFACE_INVENTORY_RELATIVE_PATH: string
  CASES_RELATIVE_PATH: string
  buildInventory: (input: BuildInput) => { errors: string[]; inventory: Inventory | null }
  serializeInventory: (inventory: Inventory) => string
  loadInputs: (root: string) => BuildInput
  headingForRenderedLink: (source: string, href: string) => string | null
  targetKindOf: (resolvedPath: string) => string
  readStatusOf: (resolvedPath: string) => string
  moduleIdOf: (resolvedPath: string) => string | null
  main: (argv: string[]) => number
}

type KnowledgeValidator = {
  SOURCE_LINK_INVENTORY_PATH: string
  CANON_C_REASON: string
  validateKnowledgeChange: (input: Record<string, unknown>) => {
    ok: boolean
    errors: string[]
    derived: { sourceLinkInventoryRequired?: boolean; sourceLinkInventoryStatus?: string }
  }
}

const generator = (await import(pathToFileURL(generatorPath).href)) as unknown as Generator
const knowledgeValidator = (await import(pathToFileURL(knowledgeValidatorPath).href)) as unknown as KnowledgeValidator

const inventoryAbsolutePath = path.join(repoRoot, generator.INVENTORY_RELATIVE_PATH)

function readJson<T>(relativePath: string): T {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T
}

function freshInputs(): BuildInput {
  return generator.loadInputs(repoRoot)
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function checkedInventory(): Inventory {
  return JSON.parse(fs.readFileSync(inventoryAbsolutePath, 'utf8')) as Inventory
}

function recordFor(inventory: Inventory, topicId: string): Record_ {
  const found = inventory.records.find((entry) => entry.topicId === topicId)
  assert.ok(found, `the inventory must contain a record for ${topicId}`)
  return found
}

test('the checked inventory is byte-identical to a fresh derivation', () => {
  const { errors, inventory } = generator.buildInventory(freshInputs())
  assert.deepEqual(errors, [])
  assert.ok(inventory)
  assert.equal(generator.serializeInventory(inventory), fs.readFileSync(inventoryAbsolutePath, 'utf8'))
})

test('the regenerate-and-diff gate fails on a stale checked inventory', () => {
  // A temporary root that reuses the real authored trees by symlink, so the gate is exercised
  // end to end without ever mutating a tracked file.
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-source-link-inventory-')))
  try {
    const createApp = path.join(root, 'packages/create-app')
    fs.mkdirSync(path.join(createApp, 'scripts/source-links'), { recursive: true })
    fs.symlinkSync(path.join(packageRoot, 'agentic'), path.join(createApp, 'agentic'), 'dir')
    fs.symlinkSync(path.join(packageRoot, 'template'), path.join(createApp, 'template'), 'dir')
    for (const relativePath of [generator.TOPICS_RELATIVE_PATH, generator.BASELINE_RELATIVE_PATH]) {
      fs.copyFileSync(path.join(repoRoot, relativePath), path.join(root, relativePath))
    }

    const mirrored = path.join(root, generator.INVENTORY_RELATIVE_PATH)
    assert.equal(generator.main(['--check', '--root', root]), 1, 'a missing inventory must fail the gate')

    fs.copyFileSync(inventoryAbsolutePath, mirrored)
    assert.equal(generator.main(['--check', '--root', root]), 0, 'the checked inventory must satisfy the gate')

    const stale = checkedInventory()
    stale.records[0].heading = 'a heading no owner renders'
    fs.writeFileSync(mirrored, generator.serializeInventory(stale))
    assert.equal(generator.main(['--check', '--root', root]), 1, 'a hand-edited inventory must fail the gate')

    fs.copyFileSync(inventoryAbsolutePath, mirrored)
    assert.equal(generator.main(['--check', '--root', root]), 0)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('decision D4: a rendered link the registry does not declare blocks generation', () => {
  const inputs = freshInputs()
  const registry = cloneJson(inputs.registry as { topics: Array<{ topicId: string; requirement: string }> })
  const dropped = registry.topics.find((topic) => topic.requirement === 'source-required')
  assert.ok(dropped)
  registry.topics = registry.topics.filter((topic) => topic.topicId !== dropped.topicId)

  const { errors, inventory } = generator.buildInventory({ ...inputs, registry })
  assert.equal(inventory, null)
  assert.ok(
    errors.some((message) => message.includes(dropped.topicId) && message.includes('absent from the checked registry')),
    `expected a derived-but-undeclared error for ${dropped.topicId}, got ${JSON.stringify(errors)}`,
  )
})

test('decision D4: a registry topic no owner renders blocks generation', () => {
  const inputs = freshInputs()
  const registry = cloneJson(inputs.registry as { topics: Array<Record<string, unknown>> })
  registry.topics.push({
    topicId: 'guides/architecture:src/modules/example/index.ts',
    owner: '.ai/guides/architecture.md',
    requirement: 'source-required',
    href: '../../src/modules/example/index.ts',
    resolvedPath: 'src/modules/example/index.ts',
  })

  const { errors, inventory } = generator.buildInventory({ ...inputs, registry })
  assert.equal(inventory, null)
  assert.ok(
    errors.some((message) => message.includes('guides/architecture:src/modules/example/index.ts')
      && message.includes('no emitted owner renders it')),
    `expected an undeliverable-topic error, got ${JSON.stringify(errors)}`,
  )
})

test('a registry href that drifts from the rendered link blocks generation', () => {
  const inputs = freshInputs()
  const registry = cloneJson(inputs.registry as { topics: Array<Record<string, unknown>> })
  const topic = registry.topics.find((entry) => entry.requirement === 'source-required')
  assert.ok(topic)
  const originalHref = topic.href as string
  topic.href = `${originalHref}x`

  const { errors, inventory } = generator.buildInventory({ ...inputs, registry })
  assert.equal(inventory, null)
  assert.ok(
    errors.some((message) => message.includes(`derived "${originalHref}"`)),
    `expected an href drift error naming ${originalHref}, got ${JSON.stringify(errors)}`,
  )
})

test('a retained normative snippet whose evidence left its owner blocks generation', () => {
  const inputs = freshInputs()
  const registry = cloneJson(inputs.registry as { topics: Array<Record<string, unknown>> })
  const topic = registry.topics.find((entry) => entry.requirement === 'retained-normative-snippet')
  assert.ok(topic)
  topic.evidence = 'this sentence is not in any emitted knowledge owner'

  const { errors, inventory } = generator.buildInventory({ ...inputs, registry })
  assert.equal(inventory, null)
  assert.ok(
    errors.some((message) => message.includes(String(topic.topicId)) && message.includes('no longer contains')),
    `expected a lost-evidence error, got ${JSON.stringify(errors)}`,
  )
})

test('the inventory covers exactly the checked topic registry, in both directions', () => {
  const inventory = checkedInventory()
  const registry = readJson<{ topics: Array<{ topicId: string; requirement: string }> }>(generator.TOPICS_RELATIVE_PATH)

  assert.deepEqual(
    inventory.records.map((entry) => entry.topicId).sort(),
    registry.topics.map((topic) => topic.topicId).sort(),
  )
  assert.equal(new Set(inventory.records.map((entry) => entry.topicId)).size, inventory.records.length)
  for (const record of inventory.records) {
    const topic = registry.topics.find((entry) => entry.topicId === record.topicId)
    assert.equal(record.requirement, topic?.requirement)
  }
  assert.equal(inventory.derived.recordCount, inventory.records.length)
  assert.equal(inventory.derived.sourceRequiredCount, 100)
  assert.equal(inventory.records.length, 125)
  assert.equal(inventory.derived.renderedLinkCount, 102)
})

test('every source-required record resolves to a file a generated app really contains', () => {
  const inventory = checkedInventory()
  const sourceRequired = inventory.records.filter((record) => record.requirement === 'source-required')
  assert.equal(sourceRequired.length, 100)
  for (const record of sourceRequired) {
    assert.ok(record.href, `${record.topicId} must record the exact rendered href`)
    assert.ok(record.targetAuthoringPath, `${record.topicId} must resolve to an authored file`)
    const absolute = path.join(packageRoot, record.targetAuthoringPath as string)
    assert.ok(fs.statSync(absolute).isFile(), `${record.topicId} must resolve to a regular file`)

    const ownerSource = fs.readFileSync(path.join(packageRoot, record.originAuthoringPath as string), 'utf8')
    assert.ok(
      ownerSource.includes(`](${record.href})`),
      `${record.originAsset} must literally render ${record.href}`,
    )
    assert.equal(record.readStatus, 'readable')
  }
})

test('rendered link counts distinguish a once-rendered link from a twice-rendered one', () => {
  const inventory = checkedInventory()
  const twice = recordFor(inventory, 'om-backend-ui-design/crud-surfaces:components/TodosTable.tsx')
  const once = recordFor(inventory, 'om-backend-ui-design/crud-surfaces:components/TodoForm.tsx')
  assert.equal(twice.renderedLinkCount, 2)
  assert.equal(once.renderedLinkCount, 1)

  const source = fs.readFileSync(path.join(packageRoot, twice.originAuthoringPath as string), 'utf8')
  assert.equal(source.split(`](${twice.href})`).length - 1, 2)
})

test('records carry the derived joins the spec names, with exact values', () => {
  const inventory = checkedInventory()
  const form = recordFor(inventory, 'guides/backend-ui:components/TodoForm.tsx')
  assert.equal(form.originAsset, '.ai/guides/backend-ui.md')
  assert.equal(form.originAuthoringPath, 'agentic/guides/backend-ui.md')
  assert.equal(form.href, '../../src/modules/example/components/TodoForm.tsx')
  assert.equal(form.resolvedPath, 'src/modules/example/components/TodoForm.tsx')
  assert.equal(form.targetAuthoringPath, 'template/src/modules/example/components/TodoForm.tsx')
  assert.equal(form.targetKind, 'canonical-example')
  assert.equal(form.moduleId, 'example')
  assert.equal(form.heading, 'Canonical example source')
  assert.deepEqual(form.capabilityIds, ['ui.form-create', 'ui.form-edit'])
  assert.deepEqual(form.integrationTestPaths, [
    'src/modules/example/__integration__/TC-EXAMPLE-001-todo-label-edit.spec.ts',
  ])
  assert.ok(form.affectedCaseIds.includes('OMH-014'))

  const registry = recordFor(inventory, 'om-system-extension/unified-overrides:src/modules.ts')
  assert.equal(registry.targetKind, 'local-owner')
  assert.equal(registry.moduleId, null)
  assert.equal(registry.resolvedPath, 'src/modules.ts')
  assert.equal(registry.targetAuthoringPath, 'template/src/modules.ts')
  assert.deepEqual(registry.capabilityIds, ['overrides.unified-registry'])
})

test('capability joins come from the example surface inventory, not from the topic registry', () => {
  const inventory = checkedInventory()
  const surface = readJson<{ capabilities: Array<{ capabilityId: string; sourcePaths: string[] }> }>(
    generator.SURFACE_INVENTORY_RELATIVE_PATH,
  )
  const knownPaths = new Set(surface.capabilities.flatMap((capability) => capability.sourcePaths))

  let joined = 0
  for (const record of inventory.records) {
    if (record.capabilityIds.length === 0) continue
    joined += 1
    assert.ok(knownPaths.has(record.resolvedPath), `${record.topicId} claims capabilities for an unlisted source path`)
    for (const capabilityId of record.capabilityIds) {
      const capability = surface.capabilities.find((entry) => entry.capabilityId === capabilityId)
      assert.ok(capability, `${record.topicId} cites unknown capability ${capabilityId}`)
      assert.ok(capability.sourcePaths.includes(record.resolvedPath))
    }
  }
  assert.equal(joined, 89)

  const unjoined = inventory.records.filter(
    (record) => record.requirement === 'source-required' && record.capabilityIds.length === 0,
  )
  assert.deepEqual(
    [...new Set(unjoined.map((record) => record.resolvedPath))].sort(),
    [
      'src/modules/example/README.md',
      'src/modules/example/references/surface-inventory.json',
      'src/modules/example/references/surface-map.md',
    ],
  )
})

test('baseline joins name real disposition records from the pinned main audit', () => {
  const inventory = checkedInventory()
  const baseline = readJson<{ blocks: Array<{ id: string; topicIds: string[]; targetTopicIds?: string[] }> }>(
    generator.BASELINE_RELATIVE_PATH,
  )
  const blocksById = new Map(baseline.blocks.map((block) => [block.id, block]))

  let replacing = 0
  for (const record of inventory.records) {
    for (const blockId of record.replacesBaselineBlockIds) {
      const block = blocksById.get(blockId)
      assert.ok(block, `${record.topicId} cites unknown baseline block ${blockId}`)
      assert.ok(block.targetTopicIds?.includes(record.topicId))
      replacing += 1
    }
    for (const blockId of record.citedByBaselineBlockIds) {
      const block = blocksById.get(blockId)
      assert.ok(block, `${record.topicId} cites unknown baseline block ${blockId}`)
      assert.ok(block.topicIds.includes(record.topicId))
    }
  }
  assert.ok(replacing > 0, 'the inventory must carry the main baseline IDs its topics replace')

  const declaredTargets = baseline.blocks.flatMap((block) => block.targetTopicIds ?? [])
  assert.equal(
    inventory.records.reduce((total, record) => total + record.replacesBaselineBlockIds.length, 0),
    declaredTargets.length,
  )
  assert.equal(
    inventory.records.reduce((total, record) => total + record.citedByBaselineBlockIds.length, 0),
    baseline.blocks.flatMap((block) => block.topicIds ?? []).length,
  )
})

test('the inventory lands at exactly the path the knowledge-change controller fails closed on', () => {
  assert.equal(generator.INVENTORY_RELATIVE_PATH, knowledgeValidator.SOURCE_LINK_INVENTORY_PATH)
  assert.ok(fs.statSync(inventoryAbsolutePath).isFile())
})

test('the CANON-C fail-closed branch resolves once the inventory is present', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-canon-c-')))
  try {
    const write = (relativePath: string, contents: string) => {
      const absolute = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, contents)
    }
    const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')
    const cases = Array.from({ length: 5 }, (_, index) => ({ id: `OMH-${String(index + 1).padStart(3, '0')}` }))
    write('.ai/harness/cases.json', JSON.stringify(cases))
    write('.ai/harness/release-matrix.json', JSON.stringify({ schemaVersion: 1, deterministic: { caseIds: 'all' } }))
    write('packages/create-app/src/lib/demo.test.ts', 'export {}\n')
    const entity = 'export const exampleSurface = 1\n'
    write('apps/mercato/src/modules/example/data/entities.ts', entity)
    write('packages/create-app/template/src/modules/example/data/entities.ts', entity)

    const manifest = {
      changeClass: 'knowledge-contract',
      baseRef: 'origin/develop',
      affectedCaseIds: ['OMH-002'],
      affectedRanges: ['OMH-001..OMH-003'],
      changedContracts: ['example-source', 'evaluator'],
      focusedTestFiles: ['packages/create-app/src/lib/demo.test.ts'],
      authoritativeFiles: [],
      generatedFiles: [],
      expectedCatalogCount: 5,
      requiredReleaseLanes: ['deterministic'],
      documentationFiles: [],
      sourceLinkInventory: { path: knowledgeValidator.SOURCE_LINK_INVENTORY_PATH },
    }
    const schema = JSON.parse(fs.readFileSync(
      path.join(packageRoot, 'agentic/shared/ai/harness/knowledge-change.schema.json'),
      'utf8',
    )) as unknown
    const run = () => knowledgeValidator.validateKnowledgeChange({
      root,
      manifest,
      schema,
      changedPaths: [
        'apps/mercato/src/modules/example/data/entities.ts',
        'packages/create-app/src/lib/demo.test.ts',
      ],
      harnessRelativeDir: '.ai/harness',
      executionEvidence: {
        errors: [],
        executions: manifest.focusedTestFiles.map((testFile) => ({
          testFile,
          command: [process.execPath, '--test', testFile],
          baseWithTestPatch: { exitCode: 1, stdoutSha256: sha256(`${testFile}b`), stderrSha256: sha256(`${testFile}e`) },
          head: { exitCode: 0, stdoutSha256: sha256(`${testFile}h`), stderrSha256: sha256(`${testFile}x`) },
        })),
      },
    })

    const absent = run()
    assert.equal(absent.derived.sourceLinkInventoryRequired, true)
    assert.equal(absent.derived.sourceLinkInventoryStatus, 'absent')
    assert.ok(absent.errors.includes(knowledgeValidator.CANON_C_REASON))

    fs.mkdirSync(path.dirname(path.join(root, generator.INVENTORY_RELATIVE_PATH)), { recursive: true })
    fs.copyFileSync(inventoryAbsolutePath, path.join(root, generator.INVENTORY_RELATIVE_PATH))

    const present = run()
    assert.equal(present.derived.sourceLinkInventoryRequired, true)
    assert.equal(present.derived.sourceLinkInventoryStatus, 'present')
    assert.ok(!present.errors.includes(knowledgeValidator.CANON_C_REASON))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the inventory is never copied into a scaffolded app', () => {
  assert.ok(generator.INVENTORY_RELATIVE_PATH.startsWith('packages/create-app/scripts/'))
  assert.ok(!generator.INVENTORY_RELATIVE_PATH.includes('agentic/'))
  assert.ok(!fs.existsSync(path.join(packageRoot, 'agentic/shared/ai/harness/source-link-inventory.json')))
})

test('derivation helpers classify targets by their real shape', () => {
  assert.equal(generator.targetKindOf('src/modules/example/index.ts'), 'canonical-example')
  assert.equal(generator.targetKindOf('src/modules.ts'), 'local-owner')
  assert.equal(generator.targetKindOf('node_modules/@open-mercato/ui/dist/index.js'), 'installed-package')
  assert.equal(generator.readStatusOf('src/modules/example/index.ts'), 'readable')
  assert.equal(generator.readStatusOf('src/modules/example/__tests__/a.test.ts'), 'qa-only')
  assert.equal(generator.readStatusOf('src/modules/example/__integration__/a.spec.ts'), 'qa-only')
  assert.equal(generator.moduleIdOf('src/modules/example/di.ts'), 'example')
  assert.equal(generator.moduleIdOf('src/modules.ts'), null)

  const source = '# One\n\ntext\n\n## Two\n\nsee [x](./a.md)\n\n## Three\n'
  assert.equal(generator.headingForRenderedLink(source, './a.md'), 'Two')
  assert.equal(generator.headingForRenderedLink(source, './missing.md'), null)
})

test('the inventory records what it does not cover instead of implying coverage', () => {
  const inventory = checkedInventory()
  assert.ok(inventory.notCovered.length > 0)
  assert.ok(inventory.records.every((record) => record.targetKind !== 'installed-package'))
  assert.ok(inventory.notCovered.some((note) => note.startsWith('installed-package targets:')))
  assert.match(inventory.generatedNote, /Never hand-edit/)
})
