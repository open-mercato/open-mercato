import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const contractPath = fileURLToPath(new URL('../../agentic/shared/scripts/knowledge-change-contract.mjs', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/knowledge-change.schema.json', import.meta.url))

type Contract = {
  CONTROLLER_OWNED_KNOWLEDGE_CHANGE_FIELDS: string[]
  deriveKnowledgeChangeClass: (input: { changedItems?: unknown[] }) => string
  validateAuthoredKnowledgeChangeManifest: (manifest: unknown) => string[]
}

const hash = (value: string) => value.repeat(64)

function authoredManifest() {
  return {
    changeClass: 'knowledge-contract',
    baseRef: 'develop',
    affectedCaseIds: ['OMH-001'],
    affectedRanges: ['routing-core'],
    changedContracts: ['routing'],
    focusedTestFiles: ['packages/create-app/src/lib/agent-harness-knowledge-change.test.ts'],
    authoritativeFiles: [{ path: 'packages/create-app/agentic/shared/AGENTS.md.template', sha256: hash('a') }],
    generatedFiles: [{
      path: 'generated/AGENTS.md',
      sha256: hash('b'),
      sourcePath: 'packages/create-app/agentic/shared/AGENTS.md.template',
    }],
    expectedCatalogCount: 202,
    requiredReleaseLanes: ['routing-primary'],
    documentationFiles: ['packages/create-app/agentic/shared/ai/harness/README.md'],
  }
}

test('knowledge-change schema pins every authored field and keeps controller evidence out of authored input', async () => {
  const contract = await import(pathToFileURL(contractPath).href) as Contract
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    additionalProperties: boolean
    required: string[]
    properties: Record<string, unknown>
    $defs: Record<string, unknown>
  }
  const expectedFields = Object.keys(authoredManifest())
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.required, expectedFields)
  assert.deepEqual(Object.keys(schema.properties), expectedFields)
  assert.ok(schema.$defs.focusedExecution)
  assert.ok(schema.$defs.executionResult)
  assert.deepEqual(contract.validateAuthoredKnowledgeChangeManifest(authoredManifest()), [])
  for (const field of contract.CONTROLLER_OWNED_KNOWLEDGE_CHANGE_FIELDS) {
    const errors = contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), [field]: field === 'focusedExecutions' ? [] : hash('c') })
    assert.ok(errors.includes(`${field} is controller-owned and must be omitted`), `${field}: ${errors.join('; ')}`)
    assert.equal(Object.hasOwn(schema.properties, field), false)
  }
})

test('valid generated and materialized copies derive asset-sync only when source and regenerated hashes agree', async () => {
  const contract = await import(pathToFileURL(contractPath).href) as Contract
  const baseSourceSha256 = hash('a')
  const generatedSha256 = hash('b')
  const changedItems = [
    {
      kind: 'generated',
      path: 'generated/AGENTS.md',
      sourcePath: 'packages/create-app/agentic/shared/AGENTS.md.template',
      baseSourceSha256,
      headSourceSha256: baseSourceSha256,
      sha256: generatedSha256,
      regeneratedSha256: generatedSha256,
    },
    {
      kind: 'materialized',
      path: 'generated/.ai/skills/om-help/SKILL.md',
      sourcePath: 'packages/create-app/agentic/shared/ai/skills/om-help/SKILL.md',
      baseSourceSha256,
      headSourceSha256: baseSourceSha256,
      sha256: generatedSha256,
      regeneratedSha256: generatedSha256,
    },
  ]
  assert.equal(contract.deriveKnowledgeChangeClass({ changedItems }), 'asset-sync')
  assert.equal(contract.deriveKnowledgeChangeClass({
    changedItems: changedItems.map((item, index) => index === 0 ? { ...item, headSourceSha256: hash('c') } : item),
  }), 'knowledge-contract')
  assert.equal(contract.deriveKnowledgeChangeClass({
    changedItems: changedItems.map((item, index) => index === 0 ? { ...item, regeneratedSha256: hash('c') } : item),
  }), 'knowledge-contract')
})

test('unknown, authoritative, mixed, empty, and unsafe changes fail closed to knowledge-contract', async () => {
  const contract = await import(pathToFileURL(contractPath).href) as Contract
  const baseSourceSha256 = hash('a')
  const generatedSha256 = hash('b')
  const generated = {
    kind: 'generated',
    path: 'generated/AGENTS.md',
    sourcePath: 'packages/create-app/agentic/shared/AGENTS.md.template',
    baseSourceSha256,
    headSourceSha256: baseSourceSha256,
    sha256: generatedSha256,
    regeneratedSha256: generatedSha256,
  }
  for (const changedItems of [
    [],
    [{ path: 'unknown/file.md' }],
    [{ kind: 'authoritative', path: 'packages/create-app/agentic/shared/AGENTS.md.template' }],
    [generated, { kind: 'authoritative', path: 'packages/create-app/agentic/shared/AGENTS.md.template' }],
    [{ ...generated, path: '../generated/AGENTS.md' }],
    [{ ...generated, sourcePath: generated.path }],
  ]) assert.equal(contract.deriveKnowledgeChangeClass({ changedItems }), 'knowledge-contract')
  assert.equal(contract.deriveKnowledgeChangeClass({}), 'knowledge-contract')
})

test('authored manifest validation rejects missing, malformed, duplicate, unsafe, and unknown fields', async () => {
  const contract = await import(pathToFileURL(contractPath).href) as Contract
  const { baseRef: _baseRef, ...missingBase } = authoredManifest()
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest(missingBase).includes('baseRef is required'))
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), changeClass: 'manual' }).includes('changeClass is invalid'))
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), focusedTestFiles: ['../escape.test.ts'] }).includes('focusedTestFiles is invalid'))
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), affectedCaseIds: ['OMH-001', 'OMH-001'] }).includes('affectedCaseIds is invalid'))
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), authoritativeFiles: [{ path: 'owner.md', sha256: 'bad' }] }).some((entry) => entry.includes('sha256')))
  assert.ok(contract.validateAuthoredKnowledgeChangeManifest({ ...authoredManifest(), unexpected: true }).includes('unexpected is not an allowed manifest field'))
})
