import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const validatorPath = path.join(sharedRoot, 'scripts', 'validate-knowledge-change.mjs')
const schemaPath = path.join(sharedRoot, 'ai', 'harness', 'knowledge-change.schema.json')
const skillDir = path.join(sharedRoot, 'ai', 'skills', 'om-evolve-harness')
const releaseMatrixPath = path.join(sharedRoot, 'ai', 'harness', 'release-matrix.json')

type Classification = {
  path: string
  rule: string
  contract: string | null
  changeClass: 'knowledge-contract' | 'asset-sync'
  focusedTest: boolean
}

type ValidationResult = {
  ok: boolean
  errors: string[]
  derived: {
    changeClass?: string
    changedContracts?: string[]
    unclassifiedPaths?: string[]
    sourceLinkInventoryRequired?: boolean
    sourceLinkInventoryStatus?: string
    sourceLinkInventoryFacts?: {
      ownerCount: number
      topicCount: number
      resolvedLinkCount: number
      declaredBaselinePath: string | null
      baselineAssetCount: number | null
      baselineDispositionCount: number | null
      baselineSha: string | null
    }
    exampleSourceMirrors?: Array<{ path: string; mirrorPath: string; state: string; readStatus: string }>
    focusedExecutions?: FocusedExecution[]
  }
}

type ExecutionOutcome = { exitCode: number; stdoutSha256: string; stderrSha256: string }
type FocusedExecution = {
  testFile: string
  command: string[]
  baseWithTestPatch: ExecutionOutcome
  head: ExecutionOutcome
}
type ExecutionEvidence = { executions: FocusedExecution[]; errors: string[] }

type Validator = {
  CHANGED_CONTRACTS: readonly string[]
  RELEASE_LANE_IDS: readonly string[]
  CONTROLLER_OWNED_FIELDS: readonly string[]
  CANON_C_REASON: string
  SOURCE_LINK_INVENTORY_PATH: string
  SOURCE_LINK_BASELINE_PATH: string
  SOURCE_LINK_BASELINE_SCHEMA_BASENAME: string
  SOURCE_LINK_BASELINE_SCHEMA_ID: string
  SOURCE_LINK_BASELINE_SCHEMA_SHA256: string
  BASELINE_SCHEMA_PROBES: ReadonlyArray<readonly [string, unknown]>
  baselineSchemaPinErrors: (baselineSchema: unknown, schemaSha256: string | null) => string[]
  STRIPPED_EXECUTION_ENV_KEYS: readonly string[]
  DEFAULT_EXECUTION_TIMEOUT_MS: number
  deriveFocusedCommand: (
    testFile: string,
    runnerFamily?: { family: string; declaredScript: string | null },
  ) => { runner?: string; argv?: string[]; error?: string }
  resolveTestRunnerFamily: (root: string, testFile: string) => { family: string; declaredScript: string | null }
  sanitizeExecutionEnv: (sourceEnv: Record<string, string | undefined>) => Record<string, string | undefined>
  runFocusedExecutions: (input: Record<string, unknown>) => ExecutionEvidence
  assertFocusedExecutionEvidence: (declaredTests: string[], evidence: ExecutionEvidence | null) => string[]
  classifyChangedPath: (value: string) => Classification
  deriveChangeClassification: (paths: string[]) => {
    changeClass: string
    changedContracts: string[]
    records: Classification[]
    unclassifiedPaths: string[]
    focusedTestPaths: string[]
  }
  expandCaseRange: (rangeId: string) => string[] | null
  exampleReadStatus: (relativePath: string) => string
  readExampleCapabilityRows: (inventory: unknown) => Array<Record<string, unknown>> | null
  exampleCoverageErrors: (
    headRows: Array<Record<string, unknown>> | null,
    baseRows: Array<Record<string, unknown>> | null,
    options?: { pathExists?: (relativePath: string) => boolean },
  ) => string[]
  validateJsonSchema: (value: unknown, schema: unknown, location?: string, rootSchema?: unknown) => string[]
  validateKnowledgeChange: (input: Record<string, unknown>) => ValidationResult
}

const validator = (await import(pathToFileURL(validatorPath).href)) as unknown as Validator
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as Record<string, any>

const EXAMPLE_AUTHORING = 'apps/mercato/src/modules/example'
const EXAMPLE_TEMPLATE = 'packages/create-app/template/src/modules/example'

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function writeFixtureFile(root: string, relativePath: string, contents: string): string {
  const absolute = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(absolute), { recursive: true })
  fs.writeFileSync(absolute, contents)
  return sha256(contents)
}

function makeFixtureRoot(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-knowledge-change-')))
  const cases = Array.from({ length: 5 }, (_, index) => ({ id: `OMH-${String(index + 1).padStart(3, '0')}` }))
  writeFixtureFile(root, '.ai/harness/cases.json', JSON.stringify(cases))
  writeFixtureFile(root, '.ai/harness/release-matrix.json', JSON.stringify({
    schemaVersion: 1,
    deterministic: { caseIds: 'all' },
    routing: {},
    writable: [],
    generatedCodeReview: {},
    generativeJudge: {},
    generatedTests: {},
  }))
  return root
}

function baseManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    changeClass: 'knowledge-contract',
    baseRef: 'origin/develop',
    affectedCaseIds: ['OMH-002'],
    affectedRanges: ['OMH-001..OMH-003'],
    changedContracts: ['routing'],
    focusedTestFiles: ['packages/create-app/src/lib/demo.test.ts'],
    authoritativeFiles: [],
    generatedFiles: [],
    expectedCatalogCount: 5,
    requiredReleaseLanes: ['deterministic'],
    documentationFiles: [],
    sourceLinkInventory: {
      path: validator.SOURCE_LINK_INVENTORY_PATH,
      baselineRef: 'a'.repeat(40),
      expectedOwnerCount: 0,
      expectedTopicCount: 0,
      resolvedLinkCount: 0,
      baselineAssetCount: 8,
      baselineDispositionCount: 136,
      baselinePath: 'packages/create-app/scripts/source-links/source-link-baseline.json',
      baselineSchemaPath: 'packages/create-app/scripts/source-links/source-link-baseline.schema.json',
    },
    ...overrides,
  }
}

function passingOutcome(seed: string): ExecutionOutcome {
  return { exitCode: 0, stdoutSha256: sha256(`${seed}-out`), stderrSha256: sha256(`${seed}-err`) }
}

function satisfiedEvidence(manifest: Record<string, unknown>): ExecutionEvidence {
  const testFiles = (manifest.focusedTestFiles as string[] | undefined) ?? []
  return {
    errors: [],
    executions: testFiles.map((testFile) => ({
      testFile,
      command: [process.execPath, '--test', testFile],
      baseWithTestPatch: { ...passingOutcome(`${testFile}-base`), exitCode: 1 },
      head: passingOutcome(`${testFile}-head`),
    })),
  }
}

function runValidation(
  root: string,
  manifest: Record<string, unknown>,
  changedPaths: string[],
  extra: Record<string, unknown> = {},
): ValidationResult {
  return validator.validateKnowledgeChange({
    root,
    manifest,
    schema,
    changedPaths,
    harnessRelativeDir: '.ai/harness',
    executionEvidence: satisfiedEvidence(manifest),
    ...extra,
  })
}

test('the knowledge-change schema pins the manifest contract the spec names', () => {
  assert.equal(schema.$id, 'https://open-mercato.dev/schemas/standalone-harness-knowledge-change.schema.json')
  assert.equal(schema.$ref, '#/$defs/authoredManifest')

  const manifestProperties = schema.$defs.manifest.properties as Record<string, unknown>
  for (const field of [
    'changeClass', 'baseRef', 'resolvedBaseSha', 'headSha', 'affectedCaseIds', 'affectedRanges',
    'changedContracts', 'focusedTestFiles', 'authoritativeFiles', 'generatedFiles', 'expectedCatalogCount',
    'requiredReleaseLanes', 'documentationFiles', 'sourceLinkInventory', 'focusedExecutions',
  ]) {
    assert.ok(Object.hasOwn(manifestProperties, field), `the manifest schema must define ${field}`)
  }
  assert.equal(schema.$defs.manifest.additionalProperties, false)
  assert.deepEqual(schema.$defs.changedContract.enum, [...validator.CHANGED_CONTRACTS])
  assert.deepEqual(schema.$defs.laneId.enum, [...validator.RELEASE_LANE_IDS])

  const releaseMatrix = JSON.parse(fs.readFileSync(releaseMatrixPath, 'utf8')) as Record<string, unknown>
  for (const lane of validator.RELEASE_LANE_IDS) {
    assert.ok(Object.hasOwn(releaseMatrix, lane), `lane ${lane} must exist in the shipped release matrix`)
  }
})

test('the schema rejects an authored manifest that carries controller-owned evidence', () => {
  const authored = schema.$defs.authoredManifest
  assert.equal(validator.validateJsonSchema(baseManifest(), authored, '$', schema).length, 0)

  for (const field of validator.CONTROLLER_OWNED_FIELDS) {
    const value = field === 'focusedExecutions' ? [] : 'b'.repeat(40)
    const errors = validator.validateJsonSchema(baseManifest({ [field]: value }), authored, '$', schema)
    assert.ok(errors.length > 0, `authored input must not be allowed to supply ${field}`)
  }

  const completed = schema.$defs.completedManifest
  assert.ok(validator.validateJsonSchema(baseManifest(), completed, '$', schema).length > 0)
  assert.equal(
    validator.validateJsonSchema(
      baseManifest({ resolvedBaseSha: 'b'.repeat(40), headSha: 'c'.repeat(40), focusedExecutions: [] }),
      completed,
      '$',
      schema,
    ).length,
    0,
  )
})

test('the schema rejects inexact path targets', () => {
  const exactPath = schema.$defs.exactPath
  for (const good of ['AGENTS.md', 'apps/mercato/src/modules/example/README.md', '.ai/harness/cases.json']) {
    assert.deepEqual(validator.validateJsonSchema(good, exactPath, '$', schema), [], good)
  }
  for (const bad of [
    '/etc/passwd',
    'C:/windows/system32',
    '../outside/file.ts',
    'apps/../../escape.ts',
    'packages/create-app/**/*.ts',
    'packages/create-app/src/lib/',
    'packages\\create-app\\src\\lib\\x.ts',
    'apps//mercato/x.ts',
    '',
  ]) {
    assert.ok(validator.validateJsonSchema(bad, exactPath, '$', schema).length > 0, `${bad} must be rejected`)
  }
})

test('the schema rejects a shell-interpolated focused-execution command', () => {
  const execution = schema.$defs.focusedExecution
  const outcome = { exitCode: 0, stdoutSha256: '0'.repeat(64), stderrSha256: '1'.repeat(64) }
  const valid = {
    testFile: 'packages/create-app/src/lib/demo.test.ts',
    command: ['node', '--test', 'packages/create-app/src/lib/demo.test.ts'],
    baseWithTestPatch: { ...outcome, exitCode: 1 },
    head: outcome,
  }
  assert.deepEqual(validator.validateJsonSchema(valid, execution, '$', schema), [])
  assert.ok(
    validator.validateJsonSchema(
      { ...valid, command: ['node --test $(cat cases.txt)'] },
      execution,
      '$',
      schema,
    ).length > 0,
  )
  assert.ok(validator.validateJsonSchema({ ...valid, command: [] }, execution, '$', schema).length > 0)
})

test('the classifier maps each governed path to its contract in monorepo and standalone layouts', () => {
  const expectations: Array<[string, string | null, string, string]> = [
    ['apps/mercato/src/modules/example/README.md', 'example-source', 'knowledge-contract', 'canonical-example-tree'],
    ['packages/create-app/template/src/modules/example/README.md', 'example-source', 'knowledge-contract', 'canonical-example-tree'],
    ['src/modules/example/data/entities.ts', 'example-source', 'knowledge-contract', 'canonical-example-tree'],
    ['packages/create-app/agentic/shared/ai/harness/source-link-inventory.json', 'source-link', 'knowledge-contract', 'source-link-inventory'],
    ['packages/create-app/template/package.json.template', 'installed-source', 'knowledge-contract', 'installed-package-manifest'],
    ['packages/create-app/package.json', 'installed-source', 'knowledge-contract', 'installed-package-manifest'],
    ['packages/create-app/agentic/shared/ai/skills/tiers.json', 'installed-source', 'knowledge-contract', 'installed-skill-closure'],
    ['packages/create-app/agentic/shared/scripts/evaluate-agent-harness.mjs', 'evaluator', 'knowledge-contract', 'evaluator-implementation'],
    ['scripts/evaluate-agent-harness.mjs', 'evaluator', 'knowledge-contract', 'evaluator-implementation'],
    ['packages/create-app/agentic/shared/ai/harness/writable-ast-oracles.mjs', 'oracle', 'knowledge-contract', 'writable-oracle'],
    ['packages/create-app/agentic/shared/ai/harness/validators.json', 'oracle', 'knowledge-contract', 'writable-oracle'],
    ['packages/create-app/agentic/shared/ai/harness/cases.json', 'context-read', 'knowledge-contract', 'case-context-policy'],
    ['.ai/harness/cases.schema.json', 'context-read', 'knowledge-contract', 'case-context-policy'],
    ['.ai/harness/fixtures/seeds.json', 'context-read', 'knowledge-contract', 'case-context-policy'],
    ['AGENTS.md', 'routing', 'knowledge-contract', 'agent-instruction-owner'],
    ['packages/create-app/agentic/shared/AGENTS.md.template', 'routing', 'knowledge-contract', 'agent-instruction-owner'],
    ['.ai/guides/architecture.md', 'routing', 'knowledge-contract', 'routing-guide-owner'],
    ['.ai/guides/modules/customers.md', null, 'asset-sync', 'generated-fact-copy'],
    ['.ai/guides/upstream/BACKWARD_COMPATIBILITY.md', null, 'asset-sync', 'generated-fact-copy'],
    ['packages/create-app/agentic/shared/ai/skills/om-evolve-harness/SKILL.md', 'skill-link', 'knowledge-contract', 'skill-authority'],
    ['.ai/skills/om-evolve-harness/references/knowledge-change.md', 'skill-link', 'knowledge-contract', 'skill-authority'],
    ['packages/cli/src/lib/generators/module-override-targets.ts', 'discovery', 'knowledge-contract', 'discovery-generator-contract'],
    ['packages/create-app/src/setup/tools/shared.ts', 'discovery', 'knowledge-contract', 'discovery-generator-contract'],
    ['packages/create-app/dist/agentic/guides/modules/example.md', null, 'asset-sync', 'materialized-copy'],
    ['.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md', null, 'asset-sync', 'materialized-copy'],
    ['packages/create-app/agentic/shared/ai/harness/README.md', null, 'asset-sync', 'docs-count-snapshot'],
    ['packages/create-app/src/lib/agent-harness-evaluator.test.ts', 'evaluator', 'knowledge-contract', 'focused-test'],
  ]

  for (const [relativePath, contract, changeClass, rule] of expectations) {
    const record = validator.classifyChangedPath(relativePath)
    assert.equal(record.contract, contract, `${relativePath} contract`)
    assert.equal(record.changeClass, changeClass, `${relativePath} class`)
    assert.equal(record.rule, rule, `${relativePath} rule`)
  }
})

test('an unclassified path fails closed to knowledge-contract', () => {
  const record = validator.classifyChangedPath('some/unknown/place/mystery.bin')
  assert.equal(record.contract, null)
  assert.equal(record.changeClass, 'knowledge-contract')
  assert.equal(record.rule, 'unclassified-fails-closed')

  const derived = validator.deriveChangeClassification(['some/unknown/place/mystery.bin'])
  assert.equal(derived.changeClass, 'knowledge-contract')
  assert.deepEqual(derived.changedContracts, [])
  assert.deepEqual(derived.unclassifiedPaths, ['some/unknown/place/mystery.bin'])
})

test('a diff of generated copies alone derives asset-sync', () => {
  const derived = validator.deriveChangeClassification([
    '.ai/guides/modules/customers.md',
    'packages/create-app/dist/agentic/guides/modules/example.md',
    'packages/create-app/agentic/shared/ai/harness/README.md',
  ])
  assert.equal(derived.changeClass, 'asset-sync')
  assert.deepEqual(derived.changedContracts, [])
})

test('a complete knowledge-contract manifest passes against its own diff', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  const authoritativeSha = writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  const result = runValidation(
    root,
    baseManifest({
      changedContracts: ['routing', 'evaluator'],
      authoritativeFiles: [{ path: 'AGENTS.md', sha256: authoritativeSha }],
    }),
    ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts'],
  )
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
  assert.equal(result.derived.changeClass, 'knowledge-contract')
  assert.deepEqual(result.derived.changedContracts, ['routing', 'evaluator'])
})

test('a declared class that differs from the derived class fails', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  const result = runValidation(
    root,
    baseManifest({ changeClass: 'asset-sync', changedContracts: ['routing', 'evaluator'] }),
    ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts'],
  )
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((error) => /declared changeClass "asset-sync" differs/.test(error)))
  assert.ok(result.errors.some((error) => /asset-sync run touches AGENTS\.md, which carries the routing contract/.test(error)))
})

test('undeclared and over-declared contracts both fail', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  writeFixtureFile(root, 'AGENTS.md', '# routing\n')

  const omitted = runValidation(root, baseManifest({ changedContracts: [] }), [
    'AGENTS.md',
    'packages/create-app/src/lib/demo.test.ts',
  ])
  assert.ok(omitted.errors.some((error) => /changedContracts omits derived contracts: routing, evaluator/.test(error)))

  const inflated = runValidation(
    root,
    baseManifest({ changedContracts: ['routing', 'evaluator', 'oracle'] }),
    ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts'],
  )
  assert.ok(inflated.errors.some((error) => /changedContracts declares contracts the diff does not touch: oracle/.test(error)))
})

test('stale hashes, unknown cases, wrong counts, bad ranges, and absent lanes are hard failures', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  writeFixtureFile(root, '.ai/guides/modules/customers.md', 'generated\n')

  const result = runValidation(
    root,
    baseManifest({
      affectedCaseIds: ['OMH-404'],
      affectedRanges: ['OMH-404..OMH-405'],
      expectedCatalogCount: 203,
      requiredReleaseLanes: [],
      authoritativeFiles: [{ path: 'AGENTS.md', sha256: '0'.repeat(64) }],
      generatedFiles: [{
        path: '.ai/guides/modules/customers.md',
        sha256: '0'.repeat(64),
        sourcePath: 'packages/create-app/src/lib/missing-source.ts',
      }],
      documentationFiles: ['docs/does-not-exist.md'],
    }),
    ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts', '.ai/guides/modules/customers.md'],
  )

  assert.equal(result.ok, false)
  const joined = result.errors.join('\n')
  assert.match(joined, /authoritativeFiles AGENTS\.md sha256 is stale/)
  assert.match(joined, /generatedFiles \.ai\/guides\/modules\/customers\.md sha256 is stale/)
  assert.match(joined, /names sourcePath packages\/create-app\/src\/lib\/missing-source\.ts, which is not an exact regular file/)
  assert.match(joined, /documentationFiles docs\/does-not-exist\.md is not an exact regular file/)
  assert.match(joined, /affectedCaseIds OMH-404 does not exist/)
  assert.match(joined, /affectedRanges OMH-404\.\.OMH-405 covers cases absent from the catalog/)
  assert.match(joined, /expectedCatalogCount 203 does not match the catalog's 5 cases/)
  assert.match(joined, /must name at least one affected certified release lane/)
})

test('a knowledge-contract change without a focused test in its own diff fails', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')

  const missing = runValidation(root, baseManifest({ focusedTestFiles: [] }), ['AGENTS.md'])
  assert.ok(missing.errors.some((error) => /requires at least one focused test/.test(error)))

  const unchanged = runValidation(root, baseManifest(), ['AGENTS.md'])
  assert.ok(unchanged.errors.some((error) => /no declared focused test appears in the diff/.test(error)))

  const notATest = runValidation(root, baseManifest({ focusedTestFiles: ['AGENTS.md'] }), ['AGENTS.md'])
  assert.ok(notATest.errors.some((error) => /focusedTestFiles AGENTS\.md is not a test file/.test(error)))
})

test('an asset-sync run whose authoritative source moved is rejected', () => {
  const root = makeFixtureRoot()
  spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' })
  spawnSync('git', ['-C', root, 'config', 'user.email', 'harness@example.test'])
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Harness'])
  writeFixtureFile(root, 'packages/create-app/src/lib/starter-presets.ts', 'export const version = 1\n')
  const generatedSha = writeFixtureFile(root, '.ai/guides/modules/customers.md', 'generated v1\n')
  spawnSync('git', ['-C', root, 'add', '-A'])
  spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', 'base'])
  const baseSha = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()

  const clean = runValidation(
    root,
    baseManifest({
      changeClass: 'asset-sync',
      changedContracts: [],
      focusedTestFiles: [],
      requiredReleaseLanes: [],
      affectedCaseIds: [],
      affectedRanges: [],
      generatedFiles: [{
        path: '.ai/guides/modules/customers.md',
        sha256: generatedSha,
        sourcePath: 'packages/create-app/src/lib/starter-presets.ts',
      }],
    }),
    ['.ai/guides/modules/customers.md'],
    { baseSha },
  )
  assert.deepEqual(clean.errors, [])

  const changedSourceSha = writeFixtureFile(root, 'packages/create-app/src/lib/starter-presets.ts', 'export const version = 2\n')
  assert.notEqual(changedSourceSha, sha256('export const version = 1\n'))
  const drifted = runValidation(
    root,
    baseManifest({
      changeClass: 'asset-sync',
      changedContracts: [],
      focusedTestFiles: [],
      requiredReleaseLanes: [],
      affectedCaseIds: [],
      affectedRanges: [],
      generatedFiles: [{
        path: '.ai/guides/modules/customers.md',
        sha256: generatedSha,
        sourcePath: 'packages/create-app/src/lib/starter-presets.ts',
      }],
    }),
    ['.ai/guides/modules/customers.md'],
    { baseSha },
  )
  assert.ok(drifted.errors.some((error) => /asset-sync run changed authoritative source/.test(error)))
})

test('example-source runs fail closed on the absent CANON-C source-link inventory', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  const contents = 'export const exampleSurface = 1\n'
  writeFixtureFile(root, `${EXAMPLE_AUTHORING}/data/entities.ts`, contents)
  writeFixtureFile(root, `${EXAMPLE_TEMPLATE}/data/entities.ts`, contents)

  const result = runValidation(
    root,
    baseManifest({ changedContracts: ['example-source', 'evaluator'] }),
    [`${EXAMPLE_AUTHORING}/data/entities.ts`, 'packages/create-app/src/lib/demo.test.ts'],
  )
  assert.equal(result.ok, false)
  assert.equal(result.derived.sourceLinkInventoryRequired, true)
  assert.equal(result.derived.sourceLinkInventoryStatus, 'absent')
  assert.ok(result.errors.includes(validator.CANON_C_REASON))
  assert.match(validator.CANON_C_REASON, /source-link-inventory\.json not present — CANON-C/)
  assert.deepEqual(result.derived.exampleSourceMirrors, [{
    path: `${EXAMPLE_AUTHORING}/data/entities.ts`,
    mirrorPath: `${EXAMPLE_TEMPLATE}/data/entities.ts`,
    readStatus: 'readable',
    state: 'mirrored',
    sha256: sha256(contents),
  }] as unknown as ValidationResult['derived']['exampleSourceMirrors'])
})

test('example-source mirror drift, deletion, and QA-only classification are derived per file', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  writeFixtureFile(root, `${EXAMPLE_AUTHORING}/data/entities.ts`, 'export const a = 1\n')
  writeFixtureFile(root, `${EXAMPLE_TEMPLATE}/data/entities.ts`, 'export const a = 2\n')
  writeFixtureFile(root, `${EXAMPLE_AUTHORING}/__tests__/example.test.ts`, 'export {}\n')

  const result = runValidation(
    root,
    baseManifest({ changedContracts: ['example-source', 'evaluator'] }),
    [
      `${EXAMPLE_AUTHORING}/data/entities.ts`,
      `${EXAMPLE_AUTHORING}/__tests__/example.test.ts`,
      'packages/create-app/src/lib/demo.test.ts',
    ],
  )

  const joined = result.errors.join('\n')
  assert.match(joined, /example-source apps\/mercato\/src\/modules\/example\/data\/entities\.ts is not byte-identical to its mirror/)
  assert.match(joined, /example-source apps\/mercato\/src\/modules\/example\/__tests__\/example\.test\.ts was moved or deleted without its byte-identical mirror/)

  const mirrors = result.derived.exampleSourceMirrors ?? []
  assert.equal(mirrors.find((entry) => entry.path.endsWith('data/entities.ts'))?.state, 'mirror-drift')
  assert.equal(mirrors.find((entry) => entry.path.includes('__tests__'))?.readStatus, 'qa-only')
  assert.equal(validator.exampleReadStatus(`${EXAMPLE_AUTHORING}/__integration__/x.ts`), 'qa-only')
  assert.equal(validator.exampleReadStatus(`${EXAMPLE_AUTHORING}/README.md`), 'readable')
})

test('case ranges expand inclusively and reject a descending bound', () => {
  assert.deepEqual(validator.expandCaseRange('OMH-001..OMH-003'), ['OMH-001', 'OMH-002', 'OMH-003'])
  assert.equal(validator.expandCaseRange('OMH-005..OMH-001'), null)
  assert.equal(validator.expandCaseRange('OMH-1..OMH-3'), null)

  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  const result = runValidation(
    root,
    baseManifest({ affectedCaseIds: ['OMH-005'], affectedRanges: ['OMH-001..OMH-003'] }),
    ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts'],
  )
  assert.ok(result.errors.some((error) => /affectedCaseIds OMH-005 falls outside every declared affected range/.test(error)))
})

test('the CLI derives the class from a real diff and refuses a mismatched baseRef', () => {
  const root = initGitFixture('om-knowledge-change-cli-')
  const artifacts = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-knowledge-change-out-')))
  const counterPath = path.join(artifacts, 'runs.log')
  fs.mkdirSync(path.join(root, '.ai', 'harness'), { recursive: true })
  fs.copyFileSync(schemaPath, path.join(root, '.ai', 'harness', 'knowledge-change.schema.json'))
  writeFixtureFile(root, '.ai/harness/cases.json', JSON.stringify([{ id: 'OMH-001' }, { id: 'OMH-002' }, { id: 'OMH-003' }]))
  writeFixtureFile(root, '.ai/harness/release-matrix.json', JSON.stringify({ deterministic: {}, routing: {} }))
  writeFixtureFile(root, 'AGENTS.md', '# routing v1\n')
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 1\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 1))
  const baseSha = commitAll(root, 'base')

  const agentsSha = writeFixtureFile(root, 'AGENTS.md', '# routing v2\n')
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 2\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 2))

  const manifestPath = path.join(artifacts, 'run.json')
  const outPath = path.join(artifacts, 'run.result.json')
  const manifest = baseManifest({
    baseRef: baseSha,
    affectedCaseIds: ['OMH-002'],
    affectedRanges: ['OMH-001..OMH-003'],
    changedContracts: ['routing', 'evaluator'],
    focusedTestFiles: ['pkg/lib.test.mjs'],
    expectedCatalogCount: 3,
    authoritativeFiles: [{ path: 'AGENTS.md', sha256: agentsSha }],
  })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const argv = [
    validatorPath, '--manifest', manifestPath, '--base', baseSha, '--root', root,
    '--harness-dir', '.ai/harness', '--out', outPath, '--execution-timeout', '90000',
  ]
  const pass = spawnSync(process.execPath, argv, { encoding: 'utf8' })
  assert.equal(pass.status, 0, `${pass.stdout}\n${pass.stderr}`)
  const report = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
    status: string
    manifest: Record<string, unknown>
    derived: Record<string, unknown>
    changedPaths: string[]
  }
  assert.equal(report.status, 'pass')
  assert.equal(report.manifest.resolvedBaseSha, baseSha)
  assert.equal(typeof report.manifest.headSha, 'string')
  assert.equal(report.derived.changeClass, 'knowledge-contract')
  assert.deepEqual(report.changedPaths, ['AGENTS.md', 'pkg/lib.mjs', 'pkg/lib.test.mjs'])

  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, baseRef: 'refs/heads/nonexistent' }, null, 2))
  const runsBeforeBadRef = countRuns(counterPath)
  const fail = spawnSync(process.execPath, argv, { encoding: 'utf8' })
  assert.equal(fail.status, 1, `${fail.stdout}\n${fail.stderr}`)
  assert.match(fail.stderr, /authored baseRef "refs\/heads\/nonexistent" does not resolve to the --base SHA/)
  assert.equal(countRuns(counterPath), runsBeforeBadRef, 'an unresolvable baseRef must not run any focused command')

  const missingArgs = spawnSync(process.execPath, [validatorPath, '--root', root], { encoding: 'utf8' })
  assert.equal(missingArgs.status, 2)
})

function initGitFixture(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)))
  spawnSync('git', ['init', '--quiet', root])
  spawnSync('git', ['-C', root, 'config', 'user.email', 'harness@example.test'])
  spawnSync('git', ['-C', root, 'config', 'user.name', 'Harness'])
  spawnSync('git', ['-C', root, 'config', 'commit.gpgsign', 'false'])
  return root
}

function commitAll(root: string, message: string): string {
  spawnSync('git', ['-C', root, 'add', '-A'])
  spawnSync('git', ['-C', root, 'commit', '--quiet', '-m', message])
  return spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
}

function focusedTestSource(counterPath: string, expected: number): string {
  return [
    "import assert from 'node:assert/strict'",
    "import fs from 'node:fs'",
    "import test from 'node:test'",
    "import { value } from './lib.mjs'",
    '',
    `fs.appendFileSync(${JSON.stringify(counterPath)}, 'run\\n')`,
    '',
    `test('lib exposes the governed value', () => {`,
    `  assert.equal(value, ${expected})`,
    '})',
    '',
  ].join('\n')
}

// A deliberately vacuous regression: it passes at base and at head, so the controller must reject it.
function baseAgnosticTestSource(counterPath: string): string {
  return [
    "import assert from 'node:assert/strict'",
    "import fs from 'node:fs'",
    "import test from 'node:test'",
    "import { value } from './lib.mjs'",
    '',
    `fs.appendFileSync(${JSON.stringify(counterPath)}, 'run\\n')`,
    '',
    `test('lib exposes some value', () => {`,
    "  assert.equal(typeof value, 'number')",
    '})',
    '',
  ].join('\n')
}

function countRuns(counterPath: string): number {
  if (!fs.existsSync(counterPath)) return 0
  return fs.readFileSync(counterPath, 'utf8').split('\n').filter(Boolean).length
}

test('the controller derives the focused command instead of accepting one from the author', () => {
  const mjs = validator.deriveFocusedCommand('packages/create-app/src/lib/demo.test.mjs')
  assert.deepEqual(mjs.argv, [process.execPath, '--test', 'packages/create-app/src/lib/demo.test.mjs'])
  assert.equal(mjs.runner, 'node-test')

  const ts = validator.deriveFocusedCommand('packages/create-app/src/lib/demo.test.ts')
  assert.deepEqual(ts.argv, [process.execPath, '--import', 'tsx', '--test', 'packages/create-app/src/lib/demo.test.ts'])
  assert.equal(ts.runner, 'node-test-tsx')

  const unsupported = validator.deriveFocusedCommand('packages/create-app/src/lib/demo.test.py')
  assert.equal(unsupported.argv, undefined)
  assert.match(String(unsupported.error), /no controller runner is registered/)

  const jestRoot = makeFixtureRoot()
  writeFixtureFile(jestRoot, 'package.json', JSON.stringify({ scripts: { test: 'jest --config jest.config.cjs' } }))
  writeFixtureFile(jestRoot, 'pkg/package.json', JSON.stringify({ scripts: { test: 'node --test pkg' } }))
  assert.deepEqual(
    validator.resolveTestRunnerFamily(jestRoot, 'src/lib/demo.test.ts'),
    { family: 'unsupported', declaredScript: 'jest --config jest.config.cjs' },
  )
  assert.deepEqual(
    validator.resolveTestRunnerFamily(jestRoot, 'pkg/demo.test.ts'),
    { family: 'node-test', declaredScript: 'node --test pkg' },
  )
  const refused = validator.deriveFocusedCommand(
    'src/lib/demo.test.ts',
    validator.resolveTestRunnerFamily(jestRoot, 'src/lib/demo.test.ts'),
  )
  assert.equal(refused.argv, undefined)
  assert.match(String(refused.error), /declares the test script "jest --config jest\.config\.cjs", which the controller cannot drive/)

  const createAppScript = (JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { scripts: Record<string, string> }).scripts.test
  assert.equal(validator.resolveTestRunnerFamily('/', 'x.test.ts').family, 'node-test')
  assert.match(createAppScript, /--test\b/, 'this package must stay on a runner the controller can drive')

  for (const derived of [mjs, ts]) {
    for (const token of derived.argv ?? []) {
      assert.doesNotMatch(token, /[`$;&|<>\n]/, `argv token ${token} must carry no shell metacharacter`)
    }
  }
})

test('focused execution evidence must show a fail-before and a pass-after for every declared test', () => {
  const declared = ['packages/create-app/src/lib/demo.test.ts']
  const outcome = { exitCode: 0, stdoutSha256: '0'.repeat(64), stderrSha256: '1'.repeat(64) }
  const record = {
    testFile: declared[0],
    command: [process.execPath, '--test', declared[0]],
    baseWithTestPatch: { ...outcome, exitCode: 1 },
    head: outcome,
  }

  assert.deepEqual(validator.assertFocusedExecutionEvidence(declared, { executions: [record], errors: [] }), [])

  const absent = validator.assertFocusedExecutionEvidence(declared, null)
  assert.equal(absent.length, 1)
  assert.match(absent[0], /produced no focused base\/head execution evidence/)

  const missingRecord = validator.assertFocusedExecutionEvidence(declared, { executions: [], errors: [] })
  assert.match(missingRecord.join('\n'), /has no base\/head execution record for declared focused test/)

  const basePassed = validator.assertFocusedExecutionEvidence(declared, {
    executions: [{ ...record, baseWithTestPatch: outcome }],
    errors: [],
  })
  assert.match(basePassed.join('\n'), /exited 0 on base-plus-test-only; the focused test must fail for the old behavior/)

  const headFailed = validator.assertFocusedExecutionEvidence(declared, {
    executions: [{ ...record, head: { ...outcome, exitCode: 3 } }],
    errors: [],
  })
  assert.match(headFailed.join('\n'), /exited 3 at head; the focused test must pass after the change/)

  const undeclared = validator.assertFocusedExecutionEvidence(declared, {
    executions: [record, { ...record, testFile: 'packages/create-app/src/lib/other.test.ts' }],
    errors: [],
  })
  assert.match(undeclared.join('\n'), /carries an execution for packages\/create-app\/src\/lib\/other\.test\.ts, which the manifest does not declare/)

  const carried = validator.assertFocusedExecutionEvidence(declared, {
    executions: [record],
    errors: ['focusedExecutions could not create an isolated worktree'],
  })
  assert.deepEqual(carried, ['focusedExecutions could not create an isolated worktree'])
})

test('a knowledge-contract manifest without controller execution evidence cannot pass', () => {
  const root = makeFixtureRoot()
  writeFixtureFile(root, 'packages/create-app/src/lib/demo.test.ts', 'export {}\n')
  const authoritativeSha = writeFixtureFile(root, 'AGENTS.md', '# routing\n')
  const manifest = baseManifest({
    changedContracts: ['routing', 'evaluator'],
    authoritativeFiles: [{ path: 'AGENTS.md', sha256: authoritativeSha }],
  })
  const changedPaths = ['AGENTS.md', 'packages/create-app/src/lib/demo.test.ts']

  const withEvidence = runValidation(root, manifest, changedPaths)
  assert.deepEqual(withEvidence.errors, [])

  const withoutEvidence = runValidation(root, manifest, changedPaths, { executionEvidence: null })
  assert.equal(withoutEvidence.ok, false)
  assert.match(withoutEvidence.errors.join('\n'), /produced no focused base\/head execution evidence/)
})

test('the controller runs each focused test once on base-plus-test-only and once at head', () => {
  const root = initGitFixture('om-knowledge-exec-')
  const counterPath = path.join(root, '..', `${path.basename(root)}-runs.log`)
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 1\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 1))
  const baseSha = commitAll(root, 'base')

  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 2\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 2))
  const dirtyBefore = spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout

  const evidence = validator.runFocusedExecutions({
    root,
    baseSha,
    headSha: baseSha,
    changedPaths: ['pkg/lib.mjs', 'pkg/lib.test.mjs'],
    testFiles: ['pkg/lib.test.mjs'],
    timeoutMs: 90_000,
  })

  assert.deepEqual(evidence.errors, [])
  assert.equal(evidence.executions.length, 1)
  const [execution] = evidence.executions
  assert.equal(execution.testFile, 'pkg/lib.test.mjs')
  assert.deepEqual(execution.command, [process.execPath, '--test', 'pkg/lib.test.mjs'])
  assert.notEqual(execution.baseWithTestPatch.exitCode, 0)
  assert.equal(execution.head.exitCode, 0)
  assert.notEqual(execution.baseWithTestPatch.stdoutSha256, execution.head.stdoutSha256)
  for (const digest of [execution.baseWithTestPatch.stdoutSha256, execution.head.stdoutSha256]) {
    assert.match(digest, /^[0-9a-f]{64}$/)
  }

  assert.equal(countRuns(counterPath), 2, 'the controller must run the command exactly once per side and never retry')
  assert.deepEqual(
    validator.sanitizeExecutionEnv({ PATH: '/usr/bin', NODE_TEST_CONTEXT: 'child-v8', NODE_OPTIONS: '--x' }),
    { PATH: '/usr/bin' },
  )
  assert.deepEqual(validator.assertFocusedExecutionEvidence(['pkg/lib.test.mjs'], evidence), [])

  const worktrees = spawnSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], { encoding: 'utf8' }).stdout
  assert.equal(worktrees.split('\n').filter((line) => line.startsWith('worktree ')).length, 1)
  assert.equal(spawnSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }).stdout, dirtyBefore)
  assert.equal(fs.readFileSync(path.join(root, 'pkg', 'lib.mjs'), 'utf8'), 'export const value = 2\n')
})

test('the controller rejects a focused test with no test-only diff against the base', () => {
  const root = initGitFixture('om-knowledge-exec-nodiff-')
  const counterPath = path.join(root, '..', `${path.basename(root)}-runs.log`)
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 1\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 1))
  const baseSha = commitAll(root, 'base')

  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 2\n')

  const evidence = validator.runFocusedExecutions({
    root,
    baseSha,
    headSha: baseSha,
    changedPaths: ['pkg/lib.mjs'],
    testFiles: ['pkg/lib.test.mjs'],
    timeoutMs: 90_000,
  })

  assert.deepEqual(evidence.executions, [])
  assert.equal(evidence.errors.length, 1)
  assert.match(evidence.errors[0], /pkg\/lib\.test\.mjs has no test-only diff against the base/)
  assert.equal(countRuns(counterPath), 0, 'a run with no test-only diff must not execute anything')
})

test('the CLI writes controller-owned focused executions and refuses a test that already passes at base', () => {
  const root = initGitFixture('om-knowledge-exec-cli-')
  const artifacts = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-knowledge-exec-out-')))
  const counterPath = path.join(artifacts, 'runs.log')
  fs.mkdirSync(path.join(root, '.ai', 'harness'), { recursive: true })
  fs.copyFileSync(schemaPath, path.join(root, '.ai', 'harness', 'knowledge-change.schema.json'))
  writeFixtureFile(root, '.ai/harness/cases.json', JSON.stringify([{ id: 'OMH-001' }, { id: 'OMH-002' }, { id: 'OMH-003' }]))
  writeFixtureFile(root, '.ai/harness/release-matrix.json', JSON.stringify({ deterministic: {}, routing: {} }))
  writeFixtureFile(root, 'AGENTS.md', '# routing v1\n')
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 1\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 1))
  const baseSha = commitAll(root, 'base')

  const agentsSha = writeFixtureFile(root, 'AGENTS.md', '# routing v2\n')
  writeFixtureFile(root, 'pkg/lib.mjs', 'export const value = 2\n')
  writeFixtureFile(root, 'pkg/lib.test.mjs', focusedTestSource(counterPath, 2))

  const manifestPath = path.join(artifacts, 'run.json')
  const outPath = path.join(artifacts, 'run.result.json')
  const manifest = baseManifest({
    baseRef: baseSha,
    changedContracts: ['routing', 'evaluator'],
    focusedTestFiles: ['pkg/lib.test.mjs'],
    expectedCatalogCount: 3,
    authoritativeFiles: [{ path: 'AGENTS.md', sha256: agentsSha }],
  })
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))

  const cli = (): ReturnType<typeof spawnSync> => spawnSync(
    process.execPath,
    [
      validatorPath, '--manifest', manifestPath, '--base', baseSha, '--root', root,
      '--harness-dir', '.ai/harness', '--out', outPath, '--execution-timeout', '90000',
    ],
    { encoding: 'utf8' },
  )

  const pass = cli()
  assert.equal(pass.status, 0, `${pass.stdout}\n${pass.stderr}`)
  const report = JSON.parse(fs.readFileSync(outPath, 'utf8')) as {
    status: string
    manifest: Record<string, unknown> & { focusedExecutions: FocusedExecution[] }
  }
  assert.equal(report.status, 'pass')
  assert.equal(report.manifest.focusedExecutions.length, 1)
  assert.equal(report.manifest.focusedExecutions[0].testFile, 'pkg/lib.test.mjs')
  assert.notEqual(report.manifest.focusedExecutions[0].baseWithTestPatch.exitCode, 0)
  assert.equal(report.manifest.focusedExecutions[0].head.exitCode, 0)
  assert.deepEqual(
    validator.validateJsonSchema(report.manifest, schema.$defs.completedManifest, '$', schema),
    [],
  )
  assert.equal(countRuns(counterPath), 2)

  writeFixtureFile(root, 'pkg/lib.test.mjs', baseAgnosticTestSource(counterPath))
  const alreadyPassing = cli()
  assert.equal(alreadyPassing.status, 1, `${alreadyPassing.stdout}\n${alreadyPassing.stderr}`)
  assert.match(alreadyPassing.stderr, /exited 0 on base-plus-test-only/)
})

test('om-evolve-harness routes to the nine mandatory knowledge-change steps', () => {
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')
  const reference = fs.readFileSync(path.join(skillDir, 'references', 'knowledge-change.md'), 'utf8')

  assert.match(skill, /references\/knowledge-change\.md/)
  assert.match(skill, /knowledge-contract/)
  assert.match(skill, /nine mandatory steps/)

  const mandatorySteps: RegExp[] = [
    /^1\. Name the changed knowledge contract and the affected case IDs\/ranges\./m,
    /^2\. Inventory every emitted knowledge owner .*`source-required`/ms,
    /^3\. Render visible exact-file links in each `source-required` owner and update the source-link inventory\./m,
    /^4\. Add a focused evaluator\/oracle\/read-policy test that fails for the old behavior/m,
    /^5\. Update the authoritative case\/context policy and the evaluator implementation together\./m,
    /^6\. Synchronize every mode-dependent surface/m,
    /^7\. Generate fresh applicable presets from a coherent build/m,
    /^8\. Prove the focused test passes and run the affected certified lane/m,
    /^9\. Generate and pass the machine validation manifest/m,
  ]
  for (const step of mandatorySteps) assert.match(reference, step)

  for (const contract of validator.CHANGED_CONTRACTS) {
    assert.ok(reference.includes(`\`${contract}\``), `the reference must name the ${contract} contract`)
  }
  assert.match(reference, /yarn workspace create-mercato-app harness:validate-knowledge-change --manifest <path> --base <ref>/)
  assert.match(reference, /yarn harness:validate-knowledge-change --manifest <path> --base <ref>/)
  assert.match(reference, /not present — CANON-C/)
  for (const field of validator.CONTROLLER_OWNED_FIELDS) {
    assert.ok(reference.includes(`\`${field}\``), `the reference must name the controller-owned field ${field}`)
  }

  for (const key of validator.STRIPPED_EXECUTION_ENV_KEYS) {
    assert.ok(reference.includes(`\`${key}\``), `the reference must name the stripped execution env key ${key}`)
  }
  assert.match(reference, /## Controller-owned base\/head execution/)
  assert.match(reference, /exactly once per side/)
  assert.match(reference, /it only drives a `node --test`\s+runner, and \*\*refuses by name\*\*/)
  assert.match(reference, /base-plus-test-only to exit \*\*non-zero\*\* and head to exit \*\*zero\*\*/)
  assert.match(reference, new RegExp(`--execution-timeout <ms>[^\\n]*default ${validator.DEFAULT_EXECUTION_TIMEOUT_MS}`))
  assert.doesNotMatch(reference, /emits an empty `focusedExecutions` today/)
})

test('both package manifests expose the knowledge-change validator under the spec-named script', () => {
  const createApp = JSON.parse(
    fs.readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { scripts: Record<string, string> }
  assert.equal(
    createApp.scripts['harness:validate-knowledge-change'],
    'node ./agentic/shared/scripts/validate-knowledge-change.mjs',
  )

  const templateRoot = new URL('../../template/', import.meta.url)
  const template = JSON.parse(
    fs.readFileSync(new URL('package.json.template', templateRoot), 'utf8'),
  ) as { scripts: Record<string, string> }
  assert.equal(
    template.scripts['harness:validate-knowledge-change'],
    'node ./scripts/validate-knowledge-change.mjs',
  )

  const placeholder = spawnSync(process.execPath, ['scripts/validate-knowledge-change.mjs'], {
    cwd: fileURLToPath(templateRoot),
    encoding: 'utf8',
  })
  assert.equal(placeholder.status, 2, placeholder.stderr || placeholder.stdout)
  assert.match(placeholder.stderr, /mercato agentic:init/)
})

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const BASELINE_PATH = 'packages/create-app/scripts/source-links/source-link-baseline.json'
const BASELINE_SCHEMA_PATH = 'packages/create-app/scripts/source-links/source-link-baseline.schema.json'
const SHIPPED_FOCUSED_TEST = 'packages/create-app/src/lib/agent-harness-knowledge-change.test.ts'

type InventoryRecord = { topicId: string; originAsset: string; renderedLinkCount?: number }
type ShippedInventory = {
  inputs: { baseline: string }
  derived: { ownerCount: number; recordCount: number; renderedLinkCount: number }
  records: InventoryRecord[]
}
type BaselineBlock = Record<string, unknown>
type ShippedBaseline = { baselineSha: string; baselineAssets: unknown[]; blocks: BaselineBlock[] }

function readJsonAt<Shape>(root: string, relativePath: string): Shape {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as Shape
}

const shippedInventory = readJsonAt<ShippedInventory>(repositoryRoot, validator.SOURCE_LINK_INVENTORY_PATH)
const shippedBaseline = readJsonAt<ShippedBaseline>(repositoryRoot, BASELINE_PATH)
const shippedBaselineSchemaSource = fs.readFileSync(path.join(repositoryRoot, BASELINE_SCHEMA_PATH), 'utf8')
const shippedBaselineSchemaSha = sha256(shippedBaselineSchemaSource)

const shippedCounts = {
  expectedOwnerCount: new Set(shippedInventory.records.map((record) => record.originAsset)).size,
  expectedTopicCount: new Set(shippedInventory.records.map((record) => record.topicId)).size,
  resolvedLinkCount: shippedInventory.records.reduce((total, record) => total + (record.renderedLinkCount ?? 0), 0),
  baselineAssetCount: shippedBaseline.baselineAssets.length,
  baselineDispositionCount: shippedBaseline.blocks.length,
}

function shippedInventoryBlock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    path: validator.SOURCE_LINK_INVENTORY_PATH,
    baselineRef: shippedBaseline.baselineSha,
    ...shippedCounts,
    baselinePath: BASELINE_PATH,
    baselineSchemaPath: BASELINE_SCHEMA_PATH,
    ...overrides,
  }
}

function validateAgainstShippedAssets(inventoryOverrides: Record<string, unknown> = {}): ValidationResult {
  const manifest = baseManifest({
    changedContracts: ['source-link', 'evaluator'],
    focusedTestFiles: [SHIPPED_FOCUSED_TEST],
    sourceLinkInventory: shippedInventoryBlock(inventoryOverrides),
  })
  return validator.validateKnowledgeChange({
    root: repositoryRoot,
    manifest,
    schema,
    changedPaths: [validator.SOURCE_LINK_INVENTORY_PATH, SHIPPED_FOCUSED_TEST],
    cases: Array.from({ length: 5 }, (_, index) => ({ id: `OMH-${String(index + 1).padStart(3, '0')}` })),
    releaseMatrix: { deterministic: { caseIds: 'all' } },
    executionEvidence: satisfiedEvidence(manifest),
  })
}

function sourceLinkErrors(result: ValidationResult): string[] {
  return result.errors.filter((error) => error.startsWith('sourceLinkInventory'))
}

// Deliberately built so record count (4), owner count (3), topic count (2) and rendered-link total
// (5) are four different numbers: a fixture where they coincide cannot tell one derivation from
// another, so counting the wrong thing would go unnoticed.
const FIXTURE_INVENTORY = {
  inputs: { baseline: BASELINE_PATH },
  records: [
    { topicId: 'guides/a:one.ts', originAsset: '.ai/guides/a.md', renderedLinkCount: 2 },
    { topicId: 'guides/a:one.ts', originAsset: '.ai/guides/b.md', renderedLinkCount: 1 },
    { topicId: 'guides/b:two.ts', originAsset: '.ai/guides/b.md', renderedLinkCount: 2 },
    { topicId: 'guides/b:two.ts', originAsset: '.ai/guides/c.md' },
  ],
}

const FIXTURE_RECORD_FACTS = { ownerCount: 3, topicCount: 2, resolvedLinkCount: 5 }

// The same records under a summary block that declares something else entirely. The gate must read
// the records; an author who edits the summary must not be able to make a wrong declaration agree.
const LAUNDERED_INVENTORY = {
  ...FIXTURE_INVENTORY,
  derived: { ownerCount: 91, topicCount: 92, recordCount: 93, renderedLinkCount: 94, sourceRequiredCount: 95 },
}

const FIXTURE_BASELINE = {
  baselineSha: 'a'.repeat(40),
  baselineAssets: [{ path: 'AGENTS.md', sha256: '0'.repeat(64), expectedFenceCount: 1 }],
  blocks: [{
    id: 'main:AGENTS.md#fence:1',
    asset: 'AGENTS.md',
    ordinal: 1,
    heading: 'Module Anatomy',
    openingLine: '```',
    info: '',
    contentSha256: '1'.repeat(64),
    topicIds: ['guides/a:one.ts'],
    disposition: 'linked',
    targetTopicIds: ['guides/a:one.ts'],
  }],
}

const FIXTURE_INVENTORY_BLOCK = {
  path: validator.SOURCE_LINK_INVENTORY_PATH,
  baselineRef: FIXTURE_BASELINE.baselineSha,
  expectedOwnerCount: FIXTURE_RECORD_FACTS.ownerCount,
  expectedTopicCount: FIXTURE_RECORD_FACTS.topicCount,
  resolvedLinkCount: FIXTURE_RECORD_FACTS.resolvedLinkCount,
  baselineAssetCount: 1,
  baselineDispositionCount: 1,
  baselinePath: BASELINE_PATH,
  baselineSchemaPath: BASELINE_SCHEMA_PATH,
}

function makeSourceLinkFixtureRoot(options: {
  inventory?: unknown
  baseline?: unknown
  schemaSource?: string
  omitBaseline?: boolean
  omitSchema?: boolean
} = {}): string {
  const root = makeFixtureRoot()
  writeFixtureFile(root, SHIPPED_FOCUSED_TEST, 'export {}\n')
  writeFixtureFile(
    root,
    validator.SOURCE_LINK_INVENTORY_PATH,
    JSON.stringify(options.inventory ?? FIXTURE_INVENTORY, null, 2),
  )
  if (!options.omitBaseline) {
    writeFixtureFile(root, BASELINE_PATH, JSON.stringify(options.baseline ?? FIXTURE_BASELINE, null, 2))
  }
  if (!options.omitSchema) {
    writeFixtureFile(root, BASELINE_SCHEMA_PATH, options.schemaSource ?? shippedBaselineSchemaSource)
  }
  return root
}

function runFixtureSourceLink(root: string, inventoryOverrides: Record<string, unknown> = {}): ValidationResult {
  return runValidation(
    root,
    baseManifest({
      changedContracts: ['source-link', 'evaluator'],
      focusedTestFiles: [SHIPPED_FOCUSED_TEST],
      sourceLinkInventory: { ...FIXTURE_INVENTORY_BLOCK, ...inventoryOverrides },
    }),
    [validator.SOURCE_LINK_INVENTORY_PATH, SHIPPED_FOCUSED_TEST],
  )
}

function validateFixtureSourceLink(root: string, inventoryOverrides: Record<string, unknown> = {}): string[] {
  return sourceLinkErrors(runFixtureSourceLink(root, inventoryOverrides))
}

test('the shipped source-link assets resolve every count a run manifest declares', () => {
  for (const [field, value] of Object.entries(shippedCounts)) {
    assert.ok(value > 0, `${field} must be a real, non-zero count in the shipped assets`)
  }
  assert.equal(shippedCounts.expectedOwnerCount, shippedInventory.derived.ownerCount)
  assert.equal(shippedCounts.resolvedLinkCount, shippedInventory.derived.renderedLinkCount)
  assert.equal(shippedInventory.inputs.baseline, BASELINE_PATH)
  // The generator emits exactly one record per topic, so the shipped asset cannot distinguish a
  // topic count from a record count. FIXTURE_INVENTORY exists to make that distinction observable.
  assert.equal(shippedCounts.expectedTopicCount, shippedInventory.records.length)
  assert.equal(shippedInventory.derived.recordCount, shippedInventory.records.length)

  const result = validateAgainstShippedAssets()
  assert.deepEqual(sourceLinkErrors(result), [])
  assert.equal(result.derived.sourceLinkInventoryStatus, 'present')
  assert.deepEqual(result.derived.sourceLinkInventoryFacts, {
    ownerCount: shippedCounts.expectedOwnerCount,
    topicCount: shippedCounts.expectedTopicCount,
    resolvedLinkCount: shippedCounts.resolvedLinkCount,
    declaredBaselinePath: BASELINE_PATH,
    baselineAssetCount: shippedCounts.baselineAssetCount,
    baselineDispositionCount: shippedCounts.baselineDispositionCount,
    baselineSha: shippedBaseline.baselineSha,
  })
  assert.equal(result.ok, true, result.errors.join('\n'))
})

test('every declared sourceLinkInventory count is compared with the real one', () => {
  const declarations: Array<[string, number, number]> = [
    ['expectedOwnerCount', 0, shippedCounts.expectedOwnerCount],
    ['expectedOwnerCount', shippedCounts.expectedOwnerCount + 1, shippedCounts.expectedOwnerCount],
    ['expectedTopicCount', 1, shippedCounts.expectedTopicCount],
    ['resolvedLinkCount', 0, shippedCounts.resolvedLinkCount],
    ['baselineAssetCount', shippedCounts.baselineAssetCount + 1, shippedCounts.baselineAssetCount],
    ['baselineDispositionCount', 0, shippedCounts.baselineDispositionCount],
  ]
  for (const [field, declared, actual] of declarations) {
    const errors = validateAgainstShippedAssets({ [field]: declared })
    const reported = sourceLinkErrors(errors)
    assert.equal(reported.length, 1, `${field}=${declared}: ${reported.join('\n')}`)
    assert.match(
      reported[0],
      new RegExp(`^sourceLinkInventory\\.${field} declares ${declared}, but \\S+ .+ resolves ${actual}$`),
      `${field}=${declared}`,
    )
    assert.equal(errors.ok, false)
  }
})

test('a declared baselineRef that does not pin the ledger commit fails', () => {
  const wrongRef = 'b'.repeat(40)
  const errors = sourceLinkErrors(validateAgainstShippedAssets({ baselineRef: wrongRef }))
  assert.deepEqual(errors, [
    `sourceLinkInventory.baselineRef declares ${wrongRef}, but ${BASELINE_PATH} pins ${shippedBaseline.baselineSha}`,
  ])
})

test('a complete fixture sourceLinkInventory block passes every derived check', () => {
  const result = runFixtureSourceLink(makeSourceLinkFixtureRoot())
  assert.deepEqual(sourceLinkErrors(result), [])
  assert.deepEqual(result.derived.sourceLinkInventoryFacts, {
    ...FIXTURE_RECORD_FACTS,
    declaredBaselinePath: BASELINE_PATH,
    baselineAssetCount: FIXTURE_BASELINE.baselineAssets.length,
    baselineDispositionCount: FIXTURE_BASELINE.blocks.length,
    baselineSha: FIXTURE_BASELINE.baselineSha,
  })
})

test('each declared count is derived from the records it names, not from the record total', () => {
  const root = makeSourceLinkFixtureRoot()
  const recordCount = FIXTURE_INVENTORY.records.length
  for (const [field, factKey] of [
    ['expectedOwnerCount', 'ownerCount'],
    ['expectedTopicCount', 'topicCount'],
    ['resolvedLinkCount', 'resolvedLinkCount'],
  ] as const) {
    assert.notEqual(FIXTURE_RECORD_FACTS[factKey], recordCount, `${field} must not coincide with the record count`)
    assert.deepEqual(validateFixtureSourceLink(root, { [field]: recordCount }), [
      `sourceLinkInventory.${field} declares ${recordCount}, but ${validator.SOURCE_LINK_INVENTORY_PATH} `
      + `${{ expectedOwnerCount: 'distinct originAsset owners', expectedTopicCount: 'distinct topic IDs', resolvedLinkCount: 'rendered links' }[field]} `
      + `resolves ${FIXTURE_RECORD_FACTS[factKey]}`,
    ])
  }
  const distinct = new Set(Object.values(FIXTURE_RECORD_FACTS))
  assert.equal(distinct.size, 3, 'the fixture facts must be mutually distinguishable')
  assert.ok(!distinct.has(recordCount), 'no fixture fact may coincide with the record count')
})

test('an inventory summary block cannot launder a declaration the records contradict', () => {
  const root = makeSourceLinkFixtureRoot({ inventory: LAUNDERED_INVENTORY })
  const result = runFixtureSourceLink(root)
  assert.deepEqual(sourceLinkErrors(result), [], 'the record-derived declaration must still pass')
  assert.deepEqual(result.derived.sourceLinkInventoryFacts, {
    ...FIXTURE_RECORD_FACTS,
    declaredBaselinePath: BASELINE_PATH,
    baselineAssetCount: FIXTURE_BASELINE.baselineAssets.length,
    baselineDispositionCount: FIXTURE_BASELINE.blocks.length,
    baselineSha: FIXTURE_BASELINE.baselineSha,
  })

  const laundered = LAUNDERED_INVENTORY.derived
  assert.deepEqual(
    validateFixtureSourceLink(root, {
      expectedOwnerCount: laundered.ownerCount,
      expectedTopicCount: laundered.topicCount,
      resolvedLinkCount: laundered.renderedLinkCount,
    }),
    [
      `sourceLinkInventory.expectedOwnerCount declares ${laundered.ownerCount}, but ${validator.SOURCE_LINK_INVENTORY_PATH} distinct originAsset owners resolves ${FIXTURE_RECORD_FACTS.ownerCount}`,
      `sourceLinkInventory.expectedTopicCount declares ${laundered.topicCount}, but ${validator.SOURCE_LINK_INVENTORY_PATH} distinct topic IDs resolves ${FIXTURE_RECORD_FACTS.topicCount}`,
      `sourceLinkInventory.resolvedLinkCount declares ${laundered.renderedLinkCount}, but ${validator.SOURCE_LINK_INVENTORY_PATH} rendered links resolves ${FIXTURE_RECORD_FACTS.resolvedLinkCount}`,
    ],
  )
})

test('a baselinePath that is not the pinned parity ledger fails', () => {
  assert.equal(validator.SOURCE_LINK_BASELINE_PATH, BASELINE_PATH)
  const root = makeSourceLinkFixtureRoot()
  const otherLedger = 'packages/create-app/scripts/source-links/other-ledger.json'
  writeFixtureFile(root, otherLedger, JSON.stringify(FIXTURE_BASELINE, null, 2))
  assert.deepEqual(validateFixtureSourceLink(root, { baselinePath: otherLedger }), [
    `sourceLinkInventory.baselinePath must be ${BASELINE_PATH}`,
  ])
})

test('an inventory cannot redirect the gate to a ledger the author fabricated', () => {
  // The exploit the pin closes: `inputs.baseline` is a string inside the asset under audit, so an
  // author who moves it — and moves `baselinePath` with it — used to have both sides agree on a
  // ledger they wrote, carrying whatever counts the manifest declares. Nothing here is missing or
  // malformed; the whole rogue set is internally consistent and schema-valid.
  const rogueLedger = 'packages/create-app/scripts/source-links/v2/source-link-baseline.json'
  const rogueSchema = 'packages/create-app/scripts/source-links/v2/source-link-baseline.schema.json'
  const root = makeSourceLinkFixtureRoot({
    inventory: { ...FIXTURE_INVENTORY, inputs: { baseline: rogueLedger } },
  })
  writeFixtureFile(root, rogueLedger, JSON.stringify({
    baselineSha: 'f'.repeat(40),
    baselineAssets: [],
    blocks: [],
  }, null, 2))
  writeFixtureFile(root, rogueSchema, shippedBaselineSchemaSource)

  assert.deepEqual(
    validateFixtureSourceLink(root, {
      baselinePath: rogueLedger,
      baselineSchemaPath: rogueSchema,
      baselineRef: 'f'.repeat(40),
      baselineAssetCount: 0,
      baselineDispositionCount: 0,
    }),
    [
      `sourceLinkInventory: ${validator.SOURCE_LINK_INVENTORY_PATH} declares inputs.baseline `
      + `${JSON.stringify(rogueLedger)}, but the parity ledger is pinned to ${BASELINE_PATH}, `
      + 'so no asset under audit may redirect which ledger is checked',
    ],
  )
})

test('a missing parity ledger fails instead of passing unread', () => {
  const result = runFixtureSourceLink(makeSourceLinkFixtureRoot({ omitBaseline: true }))
  assert.deepEqual(sourceLinkErrors(result), [
    `sourceLinkInventory.baselinePath ${BASELINE_PATH} is not an exact regular file in the working tree`,
  ])
  assert.deepEqual(
    result.derived.sourceLinkInventoryFacts,
    {
      ...FIXTURE_RECORD_FACTS,
      declaredBaselinePath: BASELINE_PATH,
      baselineAssetCount: null,
      baselineDispositionCount: null,
      baselineSha: null,
    },
    'the facts a reader most needs on a failing run must still be published',
  )
})

test('an inventory that names no baseline cannot let a manifest anchor the ledger anywhere', () => {
  const rogueLedger = 'packages/create-app/scripts/source-links/rogue-ledger.json'
  const anchorError = `sourceLinkInventory: ${validator.SOURCE_LINK_INVENTORY_PATH} declares inputs.baseline null, `
    + `but the parity ledger is pinned to ${BASELINE_PATH}, so no asset under audit may redirect `
    + 'which ledger is checked'

  for (const inputs of [undefined, {}, { baseline: 7 }, { baseline: null }]) {
    const inventory = inputs === undefined
      ? { records: FIXTURE_INVENTORY.records }
      : { records: FIXTURE_INVENTORY.records, inputs }
    const root = makeSourceLinkFixtureRoot({ inventory })
    // The exploit: the author fabricates a ledger carrying whatever counts the manifest declares.
    writeFixtureFile(root, rogueLedger, JSON.stringify({
      baselineSha: 'c'.repeat(40),
      baselineAssets: [],
      blocks: [],
    }, null, 2))
    assert.deepEqual(
      validateFixtureSourceLink(root, {
        baselinePath: rogueLedger,
        baselineRef: 'c'.repeat(40),
        baselineAssetCount: 0,
        baselineDispositionCount: 0,
        baselineSchemaPath: 'packages/create-app/scripts/source-links/source-link-baseline.schema.json',
      }),
      [anchorError],
      JSON.stringify(inputs ?? null),
    )
  }
})

test('baselineSchemaPath must name the ledger schema that sits beside the ledger', () => {
  const root = makeSourceLinkFixtureRoot()
  const elsewhere = 'packages/create-app/scripts/elsewhere.schema.json'
  writeFixtureFile(root, elsewhere, shippedBaselineSchemaSource)
  assert.deepEqual(validateFixtureSourceLink(root, { baselineSchemaPath: elsewhere }), [
    `sourceLinkInventory.baselineSchemaPath declares ${elsewhere}, but the ledger's schema is ${BASELINE_SCHEMA_PATH}`,
  ])
  assert.equal(
    validator.SOURCE_LINK_BASELINE_SCHEMA_BASENAME,
    BASELINE_SCHEMA_PATH.slice(BASELINE_SCHEMA_PATH.lastIndexOf('/') + 1),
  )
})

test('a baselineSchemaPath that names no real file fails', () => {
  assert.deepEqual(validateFixtureSourceLink(makeSourceLinkFixtureRoot({ omitSchema: true })), [
    `sourceLinkInventory.baselineSchemaPath ${BASELINE_SCHEMA_PATH} is not an exact regular file in the working tree`,
  ])
})

test('the parity ledger is validated against the schema its manifest names', () => {
  const brokenDisposition = {
    ...FIXTURE_BASELINE,
    blocks: [{ ...FIXTURE_BASELINE.blocks[0], disposition: 'invented-disposition' }],
  }
  const errors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ baseline: brokenDisposition }))
  assert.equal(errors.length, 1, errors.join('\n'))
  assert.match(
    errors[0],
    new RegExp(`^sourceLinkInventory ${BASELINE_PATH} violates ${BASELINE_SCHEMA_PATH}: \\$\\.blocks\\[0\\]\\.disposition is not in its schema enum$`),
  )

  const missingHash = {
    ...FIXTURE_BASELINE,
    blocks: [{ ...FIXTURE_BASELINE.blocks[0], contentSha256: 'not-a-hash' }],
  }
  const hashErrors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ baseline: missingHash }))
  assert.equal(hashErrors.length, 1, hashErrors.join('\n'))
  assert.match(hashErrors[0], /\$\.blocks\[0\]\.contentSha256 does not match its schema pattern$/)

  const strayField = {
    ...FIXTURE_BASELINE,
    blocks: [{ ...FIXTURE_BASELINE.blocks[0], supersededBy: 'guides/a:one.ts' }],
  }
  const strayErrors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ baseline: strayField }))
  assert.equal(strayErrors.length, 1, strayErrors.join('\n'))
  assert.match(strayErrors[0], /\$\.blocks\[0\]\.supersededBy is not allowed$/)
})

function gutSchema(mutate: (schema: Record<string, any>) => void): Record<string, any> {
  const schemaCopy = JSON.parse(shippedBaselineSchemaSource) as Record<string, any>
  mutate(schemaCopy)
  return schemaCopy
}

test('the shipped ledger schema is the pinned one and still asserts every clause the gate relies on', () => {
  const shippedBaselineSchema = JSON.parse(shippedBaselineSchemaSource) as Record<string, any>
  assert.equal(validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256, shippedBaselineSchemaSha)
  assert.deepEqual(validator.baselineSchemaPinErrors(shippedBaselineSchema, shippedBaselineSchemaSha), [])
  assert.equal(shippedBaselineSchema.$id, validator.SOURCE_LINK_BASELINE_SCHEMA_ID)
  assert.deepEqual(
    validator.validateJsonSchema(shippedBaseline, shippedBaselineSchema, '$', shippedBaselineSchema),
    [],
    'the shipped ledger must satisfy the schema the gate pins',
  )
})

test('a ledger schema that stops pinning a clause is refused before the ledger is checked', () => {
  const guttings: Array<[string, Record<string, any>]> = [
    ['wholesale replacement', { type: 'object' }],
    ['an always-true schema', {}],
    ['a foreign $id', gutSchema((s) => { s.$id = 'https://example.com/other.schema.json' })],
    ['a widened gitSha pattern', gutSchema((s) => { s.$defs.gitSha.pattern = '^.*$' })],
    ['a widened sha256 pattern', gutSchema((s) => { s.$defs.sha256.pattern = '^.*$' })],
    ['a widened assetPath pattern', gutSchema((s) => { s.$defs.assetPath.pattern = '^.*$' })],
    ['a widened block id pattern', gutSchema((s) => { s.$defs.blockDisposition.properties.id.pattern = '^.*$' })],
    ['a widened disposition enum', gutSchema((s) => { s.$defs.disposition.enum.push('invented-disposition') })],
    ['a shortened top-level required list', gutSchema((s) => { s.required = ['baselineSha'] })],
    ['an open top-level object', gutSchema((s) => { s.additionalProperties = true })],
    ['a shortened baselineAsset required list', gutSchema((s) => { s.$defs.baselineAsset.required = ['path'] })],
    ['an open baselineAsset', gutSchema((s) => { s.$defs.baselineAsset.additionalProperties = true })],
    ['a shortened blockDisposition required list', gutSchema((s) => { s.$defs.blockDisposition.required = ['id'] })],
    ['an open blockDisposition', gutSchema((s) => { s.$defs.blockDisposition.additionalProperties = true })],
    ['a loosened block ordinal', gutSchema((s) => { s.$defs.blockDisposition.properties.ordinal.type = ['integer', 'string'] })],
    ['a topicIdList that admits repeats', gutSchema((s) => { delete s.$defs.topicIdList.uniqueItems })],
  ]
  // Each is checked with the SHA pin satisfied, so only the behavioural probes can produce a reason:
  // the probe layer must still refuse these on the one occasion the pin is legitimately updated.
  for (const [label, gutted] of guttings) {
    assert.ok(validator.baselineSchemaPinErrors(gutted, validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256).length > 0, label)
  }
  // A stricter-than-pinned schema is refused too: the gate must know exactly what it is trusting.
  assert.ok(validator.baselineSchemaPinErrors(
    gutSchema((s) => { s.$defs.gitSha.pattern = '^[0-9a-f]{64}$' }),
    validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256,
  ).length > 0)
})

// Enumerated independently of the validator so no clause can be dropped from BASELINE_SCHEMA_PROBES
// without failing here — the twenty-one the spec and om-evolve-harness advertise.
const PINNED_LEDGER_CLAUSES = [
  'a non-hex baselineSha',
  'a ledger missing its blocks array',
  'a ledger missing its baselineAssets array',
  'an undeclared top-level ledger field',
  'an absolute baseline asset path',
  'a parent-traversal baseline asset path',
  'a baseline asset missing its sha256',
  'a baseline asset missing its expectedFenceCount',
  'a non-hex baseline asset sha256',
  'an undeclared baseline asset field',
  'a parent-traversal block asset path',
  'a block id that is not main:<asset>#fence:<ordinal>',
  'a block missing its contentSha256',
  'a block missing its topicIds',
  'a block missing its disposition',
  'a block missing its ordinal',
  'a non-integer block ordinal',
  'a non-hex block contentSha256',
  'an invented block disposition',
  'an undeclared block field',
  'repeated block topic IDs',
]

test('every ledger clause the gate advertises as probed is individually load-bearing', () => {
  assert.equal(PINNED_LEDGER_CLAUSES.length, 21)
  assert.deepEqual(validator.BASELINE_SCHEMA_PROBES.map(([label]) => label), PINNED_LEDGER_CLAUSES)

  const shippedBaselineSchema = JSON.parse(shippedBaselineSchemaSource) as Record<string, any>
  const permissive = { $id: validator.SOURCE_LINK_BASELINE_SCHEMA_ID }
  const reasons = validator.baselineSchemaPinErrors(permissive, validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256)
  for (const [label, ledger] of validator.BASELINE_SCHEMA_PROBES) {
    assert.ok(
      validator.validateJsonSchema(ledger, shippedBaselineSchema, '$', shippedBaselineSchema).length > 0,
      `${label} must be a real violation of the pinned schema, not a probe that proves nothing`,
    )
    assert.ok(reasons.includes(`it accepts ${label}`), `an always-true schema must be reported as accepting ${label}`)
  }
  assert.equal(reasons.length, PINNED_LEDGER_CLAUSES.length, reasons.join('\n'))
})

test('a schema that passes every probe but is not the pinned bytes is refused', () => {
  // The anyOf escape hatch: branch one is the real body, so every probe ledger and the canonical
  // minimal ledger behave exactly as before; branch two accepts anything carrying a key no probe
  // knows about. Behavioural probing cannot see it, which is why the schema is pinned by sha256.
  const shippedBaselineSchema = JSON.parse(shippedBaselineSchemaSource) as Record<string, any>
  const { $id: _pinnedId, ...realBody } = shippedBaselineSchema
  const escapeHatchSchema = {
    $id: validator.SOURCE_LINK_BASELINE_SCHEMA_ID,
    $defs: shippedBaselineSchema.$defs,
    anyOf: [realBody, { type: 'object', required: ['escapeHatch'] }],
  }
  assert.deepEqual(
    validator.baselineSchemaPinErrors(escapeHatchSchema, validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256),
    [],
    'the probes alone cannot catch an escape branch — the sha256 pin is what closes this',
  )

  const escapeHatchSource = `${JSON.stringify(escapeHatchSchema, null, 2)}\n`
  const lawlessLedger = {
    escapeHatch: true,
    baselineSha: 'f'.repeat(40),
    baselineAssets: [{ path: '/etc/passwd' }, { path: '../../outside.md' }],
    blocks: [{ id: 'anything', asset: '../../outside.md', disposition: 'invented-disposition' }],
  }
  assert.deepEqual(
    validator.validateJsonSchema(lawlessLedger, escapeHatchSchema, '$', escapeHatchSchema),
    [],
    'the escape branch must really accept a lawless ledger, or this test proves nothing',
  )

  const errors = validateFixtureSourceLink(
    makeSourceLinkFixtureRoot({ schemaSource: escapeHatchSource, baseline: lawlessLedger }),
    { baselineRef: 'f'.repeat(40), baselineAssetCount: 2, baselineDispositionCount: 1 },
  )
  assert.deepEqual(errors, [
    `sourceLinkInventory.baselineSchemaPath ${BASELINE_SCHEMA_PATH} no longer pins the ledger contract: `
    + `its sha256 is ${JSON.stringify(sha256(escapeHatchSource))} rather than the pinned `
    + `${validator.SOURCE_LINK_BASELINE_SCHEMA_SHA256}`,
  ])
})

test('a gutted ledger schema fails the run instead of waving the ledger through', () => {
  const errors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ schemaSource: '{"type":"object"}\n' }))
  assert.ok(errors.length > 0, 'a schema that asserts nothing must not validate the ledger')
  for (const error of errors) {
    assert.match(
      error,
      new RegExp(`^sourceLinkInventory\\.baselineSchemaPath ${BASELINE_SCHEMA_PATH} no longer pins the ledger contract: `),
    )
  }
  assert.ok(errors.some((error) => error.endsWith('it accepts a non-hex baselineSha')))
  assert.ok(errors.some((error) => error.includes('its $id is undefined')))

  const ledgerViolation = validateFixtureSourceLink(makeSourceLinkFixtureRoot({
    schemaSource: '{"type":"object"}\n',
    baseline: { ...FIXTURE_BASELINE, blocks: [{ ...FIXTURE_BASELINE.blocks[0], disposition: 'invented-disposition' }] },
  }))
  assert.ok(
    !ledgerViolation.some((error) => error.includes('violates')),
    'a ledger must never be reported as schema-clean by a schema the gate has refused',
  )
})

test('a refused schema never gets to report violations against the ledger', () => {
  // A refused schema that WOULD emit violations. `{"type":"object"}` cannot cover the fail-closed
  // return — it reports nothing either way — so the refusal is proved with a schema strict enough
  // that running the ledger through it would produce output the run must never carry.
  const strictened = `${JSON.stringify(gutSchema((s) => { s.required = [...s.required, 'neverPresent'] }), null, 2)}\n`
  const wouldBeViolations = validator.validateJsonSchema(
    FIXTURE_BASELINE,
    JSON.parse(strictened),
    '$',
    JSON.parse(strictened),
  )
  assert.deepEqual(wouldBeViolations, ['$.neverPresent is required'])

  const errors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ schemaSource: strictened }))
  assert.ok(errors.length > 0)
  for (const error of errors) {
    assert.match(
      error,
      new RegExp(`^sourceLinkInventory\\.baselineSchemaPath ${BASELINE_SCHEMA_PATH} no longer pins the ledger contract: `),
    )
  }
  assert.ok(
    !errors.some((error) => error.includes('violates')),
    'the gate must stop at the refusal, not go on to judge the ledger by a schema it does not trust',
  )
})

test('a ledger that repeats a block id fails even though uniqueItems accepts it', () => {
  const duplicated = {
    ...FIXTURE_BASELINE,
    blocks: [FIXTURE_BASELINE.blocks[0], { ...FIXTURE_BASELINE.blocks[0], ordinal: 2 }],
  }
  const shippedBaselineSchema = JSON.parse(shippedBaselineSchemaSource) as Record<string, any>
  assert.deepEqual(
    validator.validateJsonSchema(duplicated, shippedBaselineSchema, '$', shippedBaselineSchema),
    [],
    'uniqueItems compares whole records, so the schema alone cannot catch a repeated id',
  )
  assert.deepEqual(
    validateFixtureSourceLink(makeSourceLinkFixtureRoot({ baseline: duplicated }), { baselineDispositionCount: 2 }),
    [`sourceLinkInventory ${BASELINE_PATH} repeats block ids: ${FIXTURE_BASELINE.blocks[0].id}`],
  )
})

test('an inventory without resolvable records fails instead of counting as present', () => {
  const errors = validateFixtureSourceLink(makeSourceLinkFixtureRoot({ inventory: { inputs: { baseline: BASELINE_PATH } } }))
  assert.deepEqual(errors, [
    `sourceLinkInventory.path ${validator.SOURCE_LINK_INVENTORY_PATH} is not a readable inventory: it carries no records array`,
  ])
})

test('the governance spec example names the source-link paths the validator enforces', () => {
  const specPath = '.ai/specs/2026-08-01-standalone-harness-knowledge-governance.md'
  const spec = fs.readFileSync(path.join(repositoryRoot, specPath), 'utf8')
  const blocks = [...spec.matchAll(/```json\n([\s\S]*?)\n```/g)]
    .map((match) => match[1])
    .filter((block) => block.includes('"sourceLinkInventory"'))
  assert.equal(blocks.length, 1, `${specPath} must carry exactly one sourceLinkInventory example`)

  const example = (JSON.parse(blocks[0]) as { sourceLinkInventory: Record<string, string> }).sourceLinkInventory
  // Copied verbatim, the example must satisfy the three path rules the gate enforces.
  assert.equal(example.path, validator.SOURCE_LINK_INVENTORY_PATH)
  assert.equal(example.baselinePath, validator.SOURCE_LINK_BASELINE_PATH)
  assert.equal(shippedInventory.inputs.baseline, validator.SOURCE_LINK_BASELINE_PATH)
  assert.equal(
    example.baselineSchemaPath,
    `${example.baselinePath.slice(0, example.baselinePath.lastIndexOf('/'))}/${validator.SOURCE_LINK_BASELINE_SCHEMA_BASENAME}`,
  )
  for (const declaredPath of [example.path, example.baselinePath, example.baselineSchemaPath]) {
    assert.ok(fs.statSync(path.join(repositoryRoot, declaredPath)).isFile(), declaredPath)
  }
})

test('the topic registry the inventory derives from carries the source-link contract', () => {
  for (const relativePath of [
    'packages/create-app/scripts/source-links/source-link-topics.json',
    'packages/create-app/scripts/source-links/source-link-baseline.json',
    'packages/create-app/scripts/source-links/source-link-baseline.schema.json',
    validator.SOURCE_LINK_INVENTORY_PATH,
  ]) {
    const record = validator.classifyChangedPath(relativePath)
    assert.equal(record.contract, 'source-link', relativePath)
    assert.equal(record.rule, 'source-link-inventory', relativePath)
  }
})

// ── Declared-integration-test check (CANON gate, GOV Phase 2) ────────────────────────────────────
//
// The rule these pin: "Any future added/materially changed runtime or discovery surface with
// coverageKind: 'example' is rejected unless it declares its focused integration-test paths and
// dependency modules." It is derived from the pinned inventory, never declared in the manifest,
// because a manifest field would be exactly the waiver surface the spec forbids.

const exampleRow = (overrides: Record<string, unknown> = {}) => ({
  capabilityId: 'api.crud-factory',
  coverageKind: 'example',
  sourcePaths: ['src/modules/example/api/todos/route.ts'],
  integrationTestPaths: ['src/modules/example/__integration__/TC-EXAMPLE-001-todo-label-edit.spec.ts'],
  dependencyModules: ['example'],
  ...overrides,
})

test('an unreadable capability inventory fails closed rather than waiving every row', () => {
  assert.equal(validator.readExampleCapabilityRows(null), null)
  assert.equal(validator.readExampleCapabilityRows({}), null)
  assert.equal(validator.readExampleCapabilityRows({ capabilities: 'many' }), null)
  assert.deepEqual(validator.readExampleCapabilityRows({ capabilities: [] }), [])

  const errors = validator.exampleCoverageErrors(null, null)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /fails closed/)
})

test('a new example capability with source but no integration coverage is rejected', () => {
  const errors = validator.exampleCoverageErrors([exampleRow({ integrationTestPaths: [] })], [])
  assert.equal(errors.length, 1)
  assert.match(errors[0], /new coverageKind:"example" capability/)
})

test('a new capability that ships no source of its own is not forced to declare coverage', () => {
  const errors = validator.exampleCoverageErrors(
    [exampleRow({ capabilityId: 'module.metadata', sourcePaths: [], integrationTestPaths: [] })],
    [],
  )
  assert.deepEqual(errors, [])
})

test('a non-example capability is outside this gate', () => {
  const errors = validator.exampleCoverageErrors(
    [exampleRow({ coverageKind: 'framework', integrationTestPaths: [] })],
    [],
  )
  assert.deepEqual(errors, [])
})

test('declared coverage may not be dropped once a row has it', () => {
  const base = [exampleRow()]
  const head = [exampleRow({ integrationTestPaths: [] })]
  const errors = validator.exampleCoverageErrors(head, base)
  assert.equal(errors.length, 1)
  assert.match(errors[0], /declared 1 integration test\(s\) at the base commit and now declares none/)
})

test('an unchanged row that never declared coverage stays passing, so the ratchet only tightens', () => {
  const row = exampleRow({ capabilityId: 'module.metadata', sourcePaths: [], integrationTestPaths: [] })
  assert.deepEqual(validator.exampleCoverageErrors([row], [row]), [])
})

test('a declared path that is not a test file, or does not exist, is a failure', () => {
  const notATest = validator.exampleCoverageErrors(
    [exampleRow({ integrationTestPaths: ['src/modules/example/README.md'] })],
    [exampleRow()],
  )
  assert.equal(notATest.length, 1)
  assert.match(notATest[0], /is not a focused test file/)

  const missing = validator.exampleCoverageErrors([exampleRow()], [exampleRow()], { pathExists: () => false })
  assert.equal(missing.length, 1)
  assert.match(missing[0], /is not a file in the working tree/)
})

test('a row missing either declaration array is reported on its own terms', () => {
  const noTests = validator.exampleCoverageErrors([exampleRow({ integrationTestPaths: undefined })], [])
  assert.equal(noTests.length, 1)
  assert.match(noTests[0], /no integrationTestPaths array/)

  const noModules = validator.exampleCoverageErrors([exampleRow({ dependencyModules: undefined })], [exampleRow()])
  assert.equal(noModules.length, 1)
  assert.match(noModules[0], /no dependencyModules array/)
})

test('the shipped canonical-example inventory satisfies the gate, with paths resolved app-relative', () => {
  const repoRoot = path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)))
  const inventoryPath = path.join(repoRoot, 'apps/mercato/src/modules/example/references/surface-inventory.json')
  if (!fs.existsSync(inventoryPath)) return

  const rows = validator.readExampleCapabilityRows(JSON.parse(fs.readFileSync(inventoryPath, 'utf8')))
  assert.ok(rows && rows.length > 0)

  // Inventory rows address files the way the emitted app sees them, so they resolve under the app
  // root. Resolving them from the repository root instead makes every declaration look missing —
  // this assertion is what pins that, and it is the whole reason the check takes a pathExists hook.
  const appRelative = validator.exampleCoverageErrors(rows, rows, {
    pathExists: (relativePath) => fs.existsSync(path.join(repoRoot, 'apps/mercato', relativePath)),
  })
  assert.deepEqual(appRelative, [])

  const declared = rows.flatMap((row) => (row.integrationTestPaths as string[]) ?? [])
  assert.ok(declared.length > 0, 'the shipped inventory declares at least one integration test')
  const repoRelative = validator.exampleCoverageErrors(rows, rows, {
    pathExists: (relativePath) => fs.existsSync(path.join(repoRoot, relativePath)),
  })
  assert.ok(repoRelative.length > 0, 'repo-relative resolution must not silently pass')
  for (const error of repoRelative) assert.match(error, /is not a file in the working tree/)
})
