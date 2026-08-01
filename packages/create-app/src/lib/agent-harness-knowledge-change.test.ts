import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const contractPath = fileURLToPath(new URL('../../agentic/shared/scripts/knowledge-change-contract.mjs', import.meta.url))
const schemaPath = fileURLToPath(new URL('../../agentic/shared/ai/harness/knowledge-change.schema.json', import.meta.url))
const validatorPath = fileURLToPath(new URL('../../agentic/shared/scripts/validate-harness-knowledge-change.mjs', import.meta.url))
const HASH_PATTERN = /^[a-f0-9]{64}$/
const testTempRoot = fileURLToPath(new URL('../../../../.ai/tmp/', import.meta.url))

type Contract = {
  CONTROLLER_OWNED_KNOWLEDGE_CHANGE_FIELDS: string[]
  deriveKnowledgeChangeClass: (input: { changedItems?: unknown[] }) => string
  validateAuthoredKnowledgeChangeManifest: (manifest: unknown) => string[]
}

const hash = (value: string) => value.repeat(64)

const contentHash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

function runGit(root: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  assert.equal(result.status, 0, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`)
  return result.stdout.trim()
}

function write(root: string, relative: string, content: string) {
  const destination = path.join(root, relative)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, content)
}

function stageControllerRepository() {
  fs.mkdirSync(testTempRoot, { recursive: true })
  const root = fs.realpathSync(fs.mkdtempSync(path.join(testTempRoot, 'om-knowledge-controller-')))
  const controllerScript = 'packages/create-app/agentic/shared/scripts/validate-harness-knowledge-change.mjs'
  const contractScript = 'packages/create-app/agentic/shared/scripts/knowledge-change-contract.mjs'
  fs.mkdirSync(path.join(root, path.dirname(controllerScript)), { recursive: true })
  fs.copyFileSync(validatorPath, path.join(root, controllerScript))
  fs.copyFileSync(contractPath, path.join(root, contractScript))
  write(root, 'packages/create-app/agentic/shared/ai/harness/cases.json', `${JSON.stringify([
    {
      id: 'OMH-001',
      evaluationKind: 'routing',
      validators: ['router.contract'],
    },
    {
      id: 'OMH-002',
      evaluationKind: 'implementation',
      validators: ['artifact.contract'],
      oracle: { validatorIds: ['oracle.contract'] },
    },
  ], null, 2)}\n`)
  write(root, 'packages/create-app/agentic/shared/ai/harness/validators.json', `${JSON.stringify({
    catalog: { expectedCaseCount: 2 },
    validators: {
      'router.contract': { kind: 'routing' },
      'artifact.contract': { kind: 'artifact' },
      'oracle.contract': { kind: 'oracle' },
    },
  }, null, 2)}\n`)
  write(root, 'packages/create-app/agentic/shared/ai/harness/release-matrix.json', `${JSON.stringify({
    deterministic: { caseIds: 'all' },
    routing: { required: { caseIds: 'all' } },
    writable: [{ caseId: 'OMH-002' }],
    generatedCodeReview: { caseIds: ['OMH-002'] },
    generativeJudge: { caseIds: ['OMH-002'] },
  }, null, 2)}\n`)
  write(root, 'README.md', '# Knowledge change fixture\n')
  runGit(root, ['init', '-b', 'main'])
  runGit(root, ['config', 'user.name', 'Harness Test'])
  runGit(root, ['config', 'user.email', 'harness@example.invalid'])
  runGit(root, ['add', '.'])
  runGit(root, ['commit', '-m', 'base'])
  return { root, controllerScript, baseSha: runGit(root, ['rev-parse', 'HEAD']) }
}

function runController(root: string, controllerScript: string, manifestPath: string, baseSha: string) {
  return spawnSync(process.execPath, [path.join(root, controllerScript), '--manifest', manifestPath, '--base', baseSha], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

function writeManifest(manifestPath: string, manifest: unknown) {
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

function stageKnowledgeChange(fixture: ReturnType<typeof stageControllerRepository>) {
  write(fixture.root, 'AGENTS.md', '# New routed contract\n')
  write(fixture.root, 'contract.test.mjs', `
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
test('new routed contract exists', () => assert.match(fs.readFileSync('AGENTS.md', 'utf8'), /New routed contract/))
`)
  runGit(fixture.root, ['add', '.'])
  runGit(fixture.root, ['commit', '-m', 'knowledge contract'])
  return {
    changeClass: 'knowledge-contract',
    baseRef: fixture.baseSha,
    affectedCaseIds: ['OMH-001'],
    affectedRanges: ['routing.required'],
    changedContracts: ['routing'],
    focusedTestFiles: ['contract.test.mjs'],
    authoritativeFiles: [
      { path: 'AGENTS.md', sha256: contentHash(fs.readFileSync(path.join(fixture.root, 'AGENTS.md'))) },
      { path: 'contract.test.mjs', sha256: contentHash(fs.readFileSync(path.join(fixture.root, 'contract.test.mjs'))) },
    ],
    generatedFiles: [],
    expectedCatalogCount: 2,
    requiredReleaseLanes: ['routing.required'],
    documentationFiles: ['README.md'],
  }
}

function stageAssetSync(fixture: ReturnType<typeof stageControllerRepository>) {
  write(fixture.root, 'owner.md', 'authoritative\n')
  write(fixture.root, 'generated/owner.md', 'old generated\n')
  runGit(fixture.root, ['add', '.'])
  runGit(fixture.root, ['commit', '-m', 'asset baseline'])
  const assetBase = runGit(fixture.root, ['rev-parse', 'HEAD'])
  write(fixture.root, 'generated/owner.md', 'new generated\n')
  runGit(fixture.root, ['add', '.'])
  runGit(fixture.root, ['commit', '-m', 'refresh generated asset'])
  const generatedHash = contentHash(fs.readFileSync(path.join(fixture.root, 'generated/owner.md')))
  return {
    assetBase,
    manifest: {
      changeClass: 'asset-sync',
      baseRef: assetBase,
      affectedCaseIds: [],
      affectedRanges: [],
      changedContracts: [],
      focusedTestFiles: [],
      authoritativeFiles: [{ path: 'owner.md', sha256: contentHash(fs.readFileSync(path.join(fixture.root, 'owner.md'))) }],
      generatedFiles: [{ path: 'generated/owner.md', sha256: generatedHash, sourcePath: 'owner.md' }],
      expectedCatalogCount: 2,
      requiredReleaseLanes: [],
      documentationFiles: ['README.md'],
    },
  }
}

function expectControllerFailure(
  fixture: ReturnType<typeof stageControllerRepository>,
  manifestPath: string,
  manifest: unknown,
  baseRef: string,
  expected: RegExp,
) {
  writeManifest(manifestPath, manifest)
  const result = runController(fixture.root, fixture.controllerScript, manifestPath, baseRef)
  assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
  assert.match(result.stderr, expected)
  return result
}

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

test('controller proves a knowledge contract fails on base plus test patch and passes at clean HEAD', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-knowledge-manifest-${process.pid}-${Date.now()}.json`)
  try {
    const manifest = stageKnowledgeChange(fixture)
    writeManifest(manifestPath, manifest)
    const result = runController(fixture.root, fixture.controllerScript, manifestPath, fixture.baseSha)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /PASS knowledge change manifest — knowledge-contract/)
    const completed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      resolvedBaseSha: string
      headSha: string
      focusedExecutions: Array<{
        command: string[]
        baseWithTestPatch: { exitCode: number; stdoutSha256: string; stderrSha256: string }
        head: { exitCode: number; stdoutSha256: string; stderrSha256: string }
      }>
    }
    assert.equal(completed.resolvedBaseSha, fixture.baseSha)
    assert.equal(completed.headSha, runGit(fixture.root, ['rev-parse', 'HEAD']))
    assert.equal(completed.focusedExecutions.length, 1)
    assert.deepEqual(completed.focusedExecutions[0].command, [path.basename(process.execPath), '--test', 'contract.test.mjs'])
    assert.notEqual(completed.focusedExecutions[0].baseWithTestPatch.exitCode, 0)
    assert.equal(completed.focusedExecutions[0].head.exitCode, 0)
    assert.ok(HASH_PATTERN.test(completed.focusedExecutions[0].baseWithTestPatch.stdoutSha256))
    assert.ok(HASH_PATTERN.test(completed.focusedExecutions[0].head.stderrSha256))
    assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller accepts only a clean Git-derived asset sync with unchanged source and matching generated hash', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-asset-manifest-${process.pid}-${Date.now()}.json`)
  try {
    const { assetBase, manifest } = stageAssetSync(fixture)
    writeManifest(manifestPath, manifest)
    const result = runController(fixture.root, fixture.controllerScript, manifestPath, assetBase)
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const completed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
      resolvedBaseSha: string
      headSha: string
      focusedExecutions: unknown[]
    }
    assert.equal(completed.resolvedBaseSha, assetBase)
    assert.equal(completed.headSha, runGit(fixture.root, ['rev-parse', 'HEAD']))
    assert.deepEqual(completed.focusedExecutions, [])
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller rejects false classification and incomplete case, range, hash, count, doc, and lane surfaces', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-surface-manifest-${process.pid}-${Date.now()}.json`)
  try {
    const valid = stageKnowledgeChange(fixture)
    const invalidVariants: Array<{
      name: string
      expected: RegExp
      mutate: (manifest: ReturnType<typeof stageKnowledgeChange>) => void
    }> = [
      {
        name: 'false declared class',
        expected: /declared changeClass differs from Git-derived class: asset-sync\/knowledge-contract/,
        mutate: (manifest) => { manifest.changeClass = 'asset-sync' },
      },
      {
        name: 'missing affected case',
        expected: /knowledge-contract requires at least one affected case/,
        mutate: (manifest) => { manifest.affectedCaseIds = [] },
      },
      {
        name: 'unknown affected case',
        expected: /affected case does not exist: OMH-999/,
        mutate: (manifest) => { manifest.affectedCaseIds = ['OMH-999'] },
      },
      {
        name: 'missing derived range',
        expected: /affectedRanges is missing Git-derived range routing\.required/,
        mutate: (manifest) => { manifest.affectedRanges = [] },
      },
      {
        name: 'unknown affected range',
        expected: /affected range does not exist: routing\.unknown/,
        mutate: (manifest) => { manifest.affectedRanges.push('routing.unknown') },
      },
      {
        name: 'stale authoritative hash',
        expected: /authoritative hash is stale: AGENTS\.md/,
        mutate: (manifest) => { manifest.authoritativeFiles[0].sha256 = hash('a') },
      },
      {
        name: 'wrong catalog count',
        expected: /expectedCatalogCount is stale: 3\/2/,
        mutate: (manifest) => { manifest.expectedCatalogCount = 3 },
      },
      {
        name: 'missing documentation file',
        expected: /bounded regular file|ENOENT|no such file/i,
        mutate: (manifest) => { manifest.documentationFiles = ['missing.md'] },
      },
      {
        name: 'missing derived release lane',
        expected: /requiredReleaseLanes is missing Git-derived lane routing\.required/,
        mutate: (manifest) => { manifest.requiredReleaseLanes = [] },
      },
      {
        name: 'unknown release lane',
        expected: /release lane does not exist: routing\.unknown/,
        mutate: (manifest) => { manifest.requiredReleaseLanes.push('routing.unknown') },
      },
    ]
    for (const variant of invalidVariants) {
      const manifest = structuredClone(valid)
      variant.mutate(manifest)
      const result = expectControllerFailure(fixture, manifestPath, manifest, fixture.baseSha, variant.expected)
      assert.ok(result.stderr.length > 0, `${variant.name} must have a diagnostic`)
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller rejects missing, stale, or unowned generated copies and source paths', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-generated-manifest-${process.pid}-${Date.now()}.json`)
  try {
    const { assetBase, manifest: valid } = stageAssetSync(fixture)
    const staleHash = structuredClone(valid)
    staleHash.generatedFiles[0].sha256 = hash('a')
    expectControllerFailure(fixture, manifestPath, staleHash, assetBase, /generated hash is stale: generated\/owner\.md/)

    const missingCopy = structuredClone(valid)
    missingCopy.generatedFiles[0].path = 'generated/missing.md'
    expectControllerFailure(fixture, manifestPath, missingCopy, assetBase, /changed path is not declared: generated\/owner\.md|no such file/i)

    const missingSource = structuredClone(valid)
    missingSource.generatedFiles[0].sourcePath = 'missing-owner.md'
    expectControllerFailure(fixture, manifestPath, missingSource, assetBase, /no such file|generated source does not exist at base/i)

    const unownedSource = structuredClone(valid)
    unownedSource.generatedFiles[0].sourcePath = 'README.md'
    expectControllerFailure(fixture, manifestPath, unownedSource, assetBase, /generated sourcePath is not declared authoritative: README\.md/)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller enforces implementation-mode validators, oracles, and release lanes', () => {
  const laneFixture = stageControllerRepository()
  const laneManifestPath = path.join(testTempRoot, `om-mode-lane-manifest-${process.pid}-${Date.now()}.json`)
  try {
    const manifest = stageKnowledgeChange(laneFixture)
    manifest.affectedCaseIds = ['OMH-002']
    expectControllerFailure(laneFixture, laneManifestPath, manifest, laneFixture.baseSha, /OMH-002 requires release lane writable/)
  } finally {
    fs.rmSync(laneFixture.root, { recursive: true, force: true })
    fs.rmSync(laneManifestPath, { force: true })
  }

  for (const [label, mutate, expected] of [
    ['validator', (cases: Array<Record<string, unknown>>) => { cases[1].validators = ['missing.validator'] }, /OMH-002 references unknown validator missing\.validator/],
    ['oracle', (cases: Array<Record<string, unknown>>) => { delete cases[1].oracle }, /OMH-002 requires mode-specific oracle validators/],
  ] as const) {
    const fixture = stageControllerRepository()
    const manifestPath = path.join(testTempRoot, `om-mode-${label}-${process.pid}-${Date.now()}.json`)
    try {
      write(fixture.root, 'AGENTS.md', '# New routed contract\n')
      write(fixture.root, 'contract.test.mjs', `
import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
test('new routed contract exists', () => assert.match(fs.readFileSync('AGENTS.md', 'utf8'), /New routed contract/))
`)
      const casesPath = 'packages/create-app/agentic/shared/ai/harness/cases.json'
      const cases = JSON.parse(fs.readFileSync(path.join(fixture.root, casesPath), 'utf8')) as Array<Record<string, unknown>>
      mutate(cases)
      write(fixture.root, casesPath, `${JSON.stringify(cases, null, 2)}\n`)
      runGit(fixture.root, ['add', '.'])
      runGit(fixture.root, ['commit', '-m', `invalid mode ${label}`])
      const manifest = {
        changeClass: 'knowledge-contract',
        baseRef: fixture.baseSha,
        affectedCaseIds: ['OMH-002'],
        affectedRanges: ['routing.required'],
        changedContracts: ['context-read', 'routing'],
        focusedTestFiles: ['contract.test.mjs'],
        authoritativeFiles: ['AGENTS.md', 'contract.test.mjs', casesPath].map((relative) => ({
          path: relative,
          sha256: contentHash(fs.readFileSync(path.join(fixture.root, relative))),
        })),
        generatedFiles: [],
        expectedCatalogCount: 2,
        requiredReleaseLanes: ['routing.required', 'writable', 'generated-code-review', 'generative-judge'],
        documentationFiles: ['README.md'],
      }
      expectControllerFailure(fixture, manifestPath, manifest, fixture.baseSha, expected)
    } finally {
      fs.rmSync(fixture.root, { recursive: true, force: true })
      fs.rmSync(manifestPath, { force: true })
    }
  }
})

test('controller rejects authored evidence, mismatched base refs, and missing focused tests', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-authored-evidence-${process.pid}-${Date.now()}.json`)
  try {
    const valid = stageKnowledgeChange(fixture)
    expectControllerFailure(
      fixture,
      manifestPath,
      { ...valid, resolvedBaseSha: fixture.baseSha, headSha: runGit(fixture.root, ['rev-parse', 'HEAD']), focusedExecutions: [] },
      fixture.baseSha,
      /resolvedBaseSha is controller-owned.*headSha is controller-owned.*focusedExecutions is controller-owned/,
    )
    expectControllerFailure(
      fixture,
      manifestPath,
      { ...valid, baseRef: 'main' },
      fixture.baseSha,
      /authored baseRef must exactly match --base/,
    )
    expectControllerFailure(
      fixture,
      manifestPath,
      { ...valid, focusedTestFiles: [] },
      fixture.baseSha,
      /knowledge-contract requires at least one focused test file/,
    )
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller rejects focused tests that remain failing at HEAD', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-unchanged-failure-${process.pid}-${Date.now()}.json`)
  try {
    write(fixture.root, 'AGENTS.md', '# New routed contract\n')
    write(fixture.root, 'broken.test.mjs', `
import assert from 'node:assert/strict'
import test from 'node:test'
test('still broken', () => assert.fail('expected failure'))
`)
    runGit(fixture.root, ['add', '.'])
    runGit(fixture.root, ['commit', '-m', 'unchanged focused failure'])
    const manifest = {
      changeClass: 'knowledge-contract',
      baseRef: fixture.baseSha,
      affectedCaseIds: ['OMH-001'],
      affectedRanges: ['routing.required'],
      changedContracts: ['routing'],
      focusedTestFiles: ['broken.test.mjs'],
      authoritativeFiles: ['AGENTS.md', 'broken.test.mjs'].map((relative) => ({
        path: relative,
        sha256: contentHash(fs.readFileSync(path.join(fixture.root, relative))),
      })),
      generatedFiles: [],
      expectedCatalogCount: 2,
      requiredReleaseLanes: ['routing.required'],
      documentationFiles: ['README.md'],
    }
    expectControllerFailure(fixture, manifestPath, manifest, fixture.baseSha, /focused test does not pass at HEAD: broken\.test\.mjs/)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller derives fixed argv and never executes shell-interpolated focused paths', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-shell-path-${process.pid}-${Date.now()}.json`)
  const focusedPath = 'shell.test.mjs;touch injected'
  try {
    write(fixture.root, 'AGENTS.md', '# New routed contract\n')
    write(fixture.root, focusedPath, 'throw new Error("must not execute")\n')
    runGit(fixture.root, ['add', '.'])
    runGit(fixture.root, ['commit', '-m', 'shell-shaped focused path'])
    const manifest = {
      changeClass: 'knowledge-contract',
      baseRef: fixture.baseSha,
      affectedCaseIds: ['OMH-001'],
      affectedRanges: ['routing.required'],
      changedContracts: ['routing'],
      focusedTestFiles: [focusedPath],
      authoritativeFiles: ['AGENTS.md', focusedPath].map((relative) => ({
        path: relative,
        sha256: contentHash(fs.readFileSync(path.join(fixture.root, relative))),
      })),
      generatedFiles: [],
      expectedCatalogCount: 2,
      requiredReleaseLanes: ['routing.required'],
      documentationFiles: ['README.md'],
    }
    expectControllerFailure(fixture, manifestPath, manifest, fixture.baseSha, /focused test must use a fixed Node test filename/)
    assert.equal(fs.existsSync(path.join(fixture.root, 'injected')), false)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})

test('controller rejects dirty HEAD and an absent focused-test diff before executing evidence', () => {
  const fixture = stageControllerRepository()
  const manifestPath = path.join(testTempRoot, `om-invalid-manifest-${process.pid}-${Date.now()}.json`)
  try {
    write(fixture.root, 'AGENTS.md', '# New routed contract\n')
    runGit(fixture.root, ['add', '.'])
    runGit(fixture.root, ['commit', '-m', 'knowledge contract without test'])
    const manifest = {
      changeClass: 'knowledge-contract',
      baseRef: fixture.baseSha,
      affectedCaseIds: ['OMH-001'],
      affectedRanges: ['routing.required'],
      changedContracts: ['routing'],
      focusedTestFiles: ['packages/create-app/agentic/shared/scripts/knowledge-change-contract.mjs'],
      authoritativeFiles: [{ path: 'AGENTS.md', sha256: contentHash(fs.readFileSync(path.join(fixture.root, 'AGENTS.md'))) }],
      generatedFiles: [],
      expectedCatalogCount: 2,
      requiredReleaseLanes: ['routing.required'],
      documentationFiles: ['README.md'],
    }
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    const absent = runController(fixture.root, fixture.controllerScript, manifestPath, fixture.baseSha)
    assert.equal(absent.status, 2)
    assert.match(absent.stderr, /focused test diff is absent/)
    write(fixture.root, 'DIRTY.md', 'dirty\n')
    const dirty = runController(fixture.root, fixture.controllerScript, manifestPath, fixture.baseSha)
    assert.equal(dirty.status, 2)
    assert.match(dirty.stderr, /committed and clean/)
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(manifestPath, { force: true })
  }
})
