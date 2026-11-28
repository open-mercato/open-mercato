import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const agenticRoot = fileURLToPath(new URL('../../agentic/', import.meta.url))
const packageRoot = path.resolve(agenticRoot, '..')

const CASE_ID = 'OMH-256'
const OWNER = '.ai/skills/om-backend-ui-design/references/frontend-and-design-system.md'
const OWNER_SOURCE = 'shared/ai/skills/om-backend-ui-design/references/frontend-and-design-system.md'
const BLOCK_IDS = ['entity-header', 'key-value', 'timeline', 'kanban', 'wizard', 'stack']
const CONTRACT_FILES = ['shared', ...BLOCK_IDS].map((name) => `src/blocks/contracts/${name}.ts`)

type HarnessCase = {
  id: string
  evaluationKind: string
  owner: { path: string }
  requiredSkills: string[]
  context: { required: string[]; sourceReferenceIds?: string[] }
  requiredDecisions: string[]
}

type InventoryRecord = {
  topicId: string
  originAsset: string
  requirement: string
  targetKind: string
  readStatus: string
  packageName?: string
  packageRelativePath?: string
  affectedCaseIds: string[]
}

function read(relativePath: string): string {
  return fs.readFileSync(path.join(agenticRoot, relativePath), 'utf8')
}

function referenceIdFor(contractFile: string): string {
  return `om-backend-ui-design/frontend-and-design-system:node_modules/@open-mercato/ui/${contractFile}`
}

test('the UI design reference tells agents to import a business block before composing one by hand', () => {
  const reference = read(OWNER_SOURCE)
  assert.match(reference, /^## Business Blocks$/m)
  assert.ok(reference.includes('@open-mercato/ui/blocks/<block>'))
  for (const blockId of BLOCK_IDS) {
    assert.ok(reference.includes(`\`${blockId}\``), `the reference must name the ${blockId} block`)
  }
  for (const contractFile of CONTRACT_FILES) {
    assert.ok(
      reference.includes(`(../../../../node_modules/@open-mercato/ui/${contractFile})`),
      `the reference must link the exact installed contract ${contractFile}`,
    )
  }
  assert.match(reference, /no data source/)
})

test('the UI design reference documents the tracked copy path and its lock file', () => {
  const reference = read(OWNER_SOURCE)
  assert.ok(reference.includes('yarn mercato ui add <block> --module <moduleId>'))
  assert.ok(reference.includes('yarn mercato ui diff'))
  assert.ok(reference.includes('src/modules/<moduleId>/components/blocks/<block>/'))
  assert.ok(reference.includes('blocks.lock.json'))
  assert.match(reference, /only when the module needs a different structure/)
  assert.match(reference, /--force/)
})

test('the always-read backend UI guide and the skill workflow route block work to the reference', () => {
  const guide = read('guides/backend-ui.md')
  assert.ok(guide.includes('@open-mercato/ui/blocks/<block>'))
  const skill = read('shared/ai/skills/om-backend-ui-design/SKILL.md')
  assert.match(skill, /Business Blocks/)
  assert.match(skill, /references\/frontend-and-design-system\.md/)
})

test('a routing case requires the block decisions and the exact installed contracts', () => {
  const cases = JSON.parse(read('shared/ai/harness/cases.json')) as HarnessCase[]
  const scenario = cases.find((entry) => entry.id === CASE_ID)
  assert.ok(scenario, `${CASE_ID} must exist`)
  assert.equal(scenario.evaluationKind, 'routing')
  assert.equal(scenario.owner.path, OWNER)
  assert.deepEqual(scenario.requiredSkills, ['om-backend-ui-design'])
  for (const required of ['.ai/guides/backend-ui.md', '.ai/skills/om-backend-ui-design/SKILL.md', OWNER]) {
    assert.ok(scenario.context.required.includes(required), `${CASE_ID} must require ${required}`)
  }
  for (const contractFile of CONTRACT_FILES) {
    assert.ok(scenario.context.sourceReferenceIds?.includes(referenceIdFor(contractFile)))
  }
  for (const decision of [
    'business-block-import-first',
    'block-contract-reference-source',
    'block-data-through-props',
    'block-copy-only-for-structure-change',
    'blocks-lock-tracked-copy',
    'block-diff-before-force',
  ]) {
    assert.ok(scenario.requiredDecisions.includes(decision), `missing block decision ${decision}`)
  }
})

test('the source-link inventory resolves every block contract for the routing case', () => {
  const inventory = JSON.parse(
    fs.readFileSync(path.join(packageRoot, 'scripts/source-links/source-link-inventory.json'), 'utf8'),
  ) as { records: InventoryRecord[] }
  for (const contractFile of CONTRACT_FILES) {
    const record = inventory.records.find((entry) => entry.topicId === referenceIdFor(contractFile))
    assert.ok(record, `missing inventory record for ${contractFile}`)
    assert.equal(record.originAsset, OWNER)
    assert.equal(record.requirement, 'source-required')
    assert.equal(record.targetKind, 'installed-package')
    assert.equal(record.readStatus, 'readable')
    assert.equal(record.packageName, '@open-mercato/ui')
    assert.equal(record.packageRelativePath, contractFile)
    assert.ok(record.affectedCaseIds.includes(CASE_ID))
  }
})
