import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const releaseScript = fileURLToPath(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url))
const releaseSchema = fileURLToPath(new URL('../../agentic/shared/ai/harness/release-result.schema.json', import.meta.url))
const targetValidationSchema = fileURLToPath(new URL('../../agentic/shared/ai/harness/target-validation-result.schema.json', import.meta.url))
const executionSandboxScript = fileURLToPath(new URL('../../agentic/shared/scripts/execution-sandbox.mjs', import.meta.url))
const monorepoNodeModules = fs.realpathSync(fileURLToPath(new URL('../../../../node_modules', import.meta.url)))
const release = await import(pathToFileURL(releaseScript).href) as {
  buildReleasePlan: (input: Record<string, unknown>) => any
  aggregateQualityMetrics: (results: any[]) => any
  sanitizeReportText: (value: string, roots?: string[]) => string
  createMinimalValidationEnvironment: (tempRoot: string, pathValue?: string) => { env: NodeJS.ProcessEnv; toolReadRoots: string[] }
  prepareWritableTargets: (input: { root: string; prepareRoot: string; caseIds: string[] }) => { schemaVersion: number; targets: Record<string, string> }
  resolvePreparationRoot: (requested: string, controllerRoot: string) => string
  dependencyContentFingerprint: (appRoot: string) => string
  runTargetValidationSteps: (input: { steps: any[]; target: string; timeout: number; roots: string[]; yarnCommand: string; pathValue?: string }) => any[]
  runGeneratedTestStep: (input: { steps?: never; step: any; target: string; timeout: number; roots: string[]; browserRuntimeResolver?: (target: string, cache: string) => any }) => any
  generatedTestExecutionContract: (entry: { runner: string; artifact: string }) => { executor: string; cliPackage: string; argv: string[]; command: string }
  targetContentFingerprint: (root: string) => string
}
const executionSandbox = await import(pathToFileURL(executionSandboxScript).href) as {
  linuxNamespaceArgs: (network: string) => string[]
  sandboxedInvocation: (input: Record<string, unknown>) => { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv }
}
const targetSandboxAvailable = process.platform === 'darwin'
  || (process.platform === 'linux' && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0)

function releaseInputs() {
  const targetA = path.join(os.tmpdir(), 'om-release-OMH-002')
  const targetB = path.join(os.tmpdir(), 'om-release-OMH-003')
  const cases = [
    { id: 'OMH-001', family: 'architecture', mode: 'analysis', evaluationKind: 'routing' },
    {
      id: 'OMH-002', family: 'module', mode: 'one-shot', evaluationKind: 'implementation',
      fixture: { scaffold: 'fresh-standalone', setup: ['fixture:module'] },
      oracle: { validatorIds: ['oracle.module'], expectedArtifacts: ['src/modules/example/entity.ts'] },
    },
    {
      id: 'OMH-003', family: 'bugfix', mode: 'bugfix', evaluationKind: 'regression',
      fixture: { scaffold: 'fresh-standalone', setup: ['fixture:regression'] },
      oracle: { validatorIds: ['oracle.regression'], expectedArtifacts: ['src/modules/example/fix.ts'] },
    },
  ]
  const registry = {
    catalog: { expectedCaseCount: 3, writableCaseIds: ['OMH-002', 'OMH-003'] },
    validators: {
      'oracle.module': { implementation: 'trusted-executable', runners: ['writable-ast-oracles.mjs'] },
      'oracle.regression': { implementation: 'trusted-executable', runners: ['writable-ast-oracles.mjs', 'writable-behavior-oracles.mjs'] },
    },
  }
  const releaseMatrix = {
    deterministic: { caseIds: 'all' },
    releaseSuite: {
      routingRunners: ['codex', 'claude'],
      requireGeneratedCodeReview: true,
      validationCommands: ['yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build'],
    },
    routing: {
      codex: { caseIds: 'all', modelSelector: 'default' },
      claude: { caseIds: ['OMH-002', 'OMH-003'], modelSelector: 'sonnet' },
    },
    writable: [
      { caseId: 'OMH-002', runner: 'codex', modelSelector: 'default' },
      { caseId: 'OMH-003', runner: 'claude', modelSelector: 'sonnet' },
    ],
    generatedCodeReview: {
      required: true,
      skill: 'om-code-review',
      caseIds: ['OMH-002', 'OMH-003'],
      runners: { codex: { modelSelector: 'default' }, claude: { modelSelector: 'sonnet' } },
    },
    generatedTests: { required: true, entries: [] },
  }
  const fixtures = { fixtures: { module: {}, regression: {} } }
  const seeds = { fixtures: { module: {}, regression: {} } }
  const targetsManifest = { schemaVersion: 1, targets: { 'OMH-002': targetA, 'OMH-003': targetB } }
  return { cases, registry, releaseMatrix, fixtures, seeds, targetsManifest }
}

test('release plan derives every count and command from catalog and matrix data', () => {
  const plan = release.buildReleasePlan(releaseInputs())
  assert.deepEqual(plan.violations, [])
  assert.deepEqual(plan.catalog, { caseCount: 3, writableCaseCount: 2, reviewEligibleCaseCount: 2 })
  assert.deepEqual(plan.coverage.deterministic.configuredCaseIds, ['OMH-001', 'OMH-002', 'OMH-003'])
  assert.deepEqual(plan.coverage.writable.configuredCaseIds, ['OMH-002', 'OMH-003'])
  assert.deepEqual(plan.coverage.review.configuredCaseIds, ['OMH-002', 'OMH-003'])
  assert.deepEqual(plan.steps.map((step: { id: string }) => step.id), [
    'deterministic:all',
    'validation:generate', 'validation:typecheck', 'validation:lint', 'validation:build',
    'routing:codex', 'routing:claude',
    'fixture:OMH-002', 'writable:OMH-002',
    'target-validation:OMH-002:generate', 'target-validation:OMH-002:typecheck', 'target-validation:OMH-002:lint', 'target-validation:OMH-002:build',
    'review:OMH-002',
    'fixture:OMH-003', 'writable:OMH-003',
    'target-validation:OMH-003:generate', 'target-validation:OMH-003:typecheck', 'target-validation:OMH-003:lint', 'target-validation:OMH-003:build',
    'review:OMH-003',
  ])
})

test('release preflight rejects weakened runner, review, command, and model contracts', () => {
  const missingClaude = releaseInputs()
  missingClaude.releaseMatrix.releaseSuite.routingRunners = ['codex']
  assert.ok(release.buildReleasePlan(missingClaude).violations.some((entry: string) => entry.includes('routing runners must be exactly')))

  const duplicateReview = releaseInputs()
  duplicateReview.releaseMatrix.generatedCodeReview.caseIds.push('OMH-002')
  const duplicateReviewViolations = release.buildReleasePlan(duplicateReview).violations
  assert.ok(duplicateReviewViolations.some((entry: string) => entry.includes('review matrix contains duplicate cases')))
  assert.ok(duplicateReviewViolations.some((entry: string) => entry.includes('exactly once in catalog order')))

  const duplicateValidation = releaseInputs()
  duplicateValidation.releaseMatrix.releaseSuite.validationCommands = [
    'yarn generate', 'yarn generate', 'yarn typecheck', 'yarn lint', 'yarn build',
  ]
  assert.ok(release.buildReleasePlan(duplicateValidation).violations.some((entry: string) => entry.includes('exact ordered four-command gate')))

  for (const mutate of [
    (input: ReturnType<typeof releaseInputs>) => { input.releaseMatrix.routing.codex.modelSelector = '' },
    (input: ReturnType<typeof releaseInputs>) => { input.releaseMatrix.writable[0].modelSelector = '' },
    (input: ReturnType<typeof releaseInputs>) => { input.releaseMatrix.generatedCodeReview.runners.codex.modelSelector = '' },
  ]) {
    const emptySelector = releaseInputs()
    mutate(emptySelector)
    assert.ok(release.buildReleasePlan(emptySelector).violations.some((entry: string) => entry.includes('valid bounded')), JSON.stringify(emptySelector.releaseMatrix))
  }
})

test('automatic target preparation clones only fresh source inputs and safely shares installed dependencies', { skip: process.platform === 'win32' }, () => {
  const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-source-')))
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-target-parent-')))
  const prepareRoot = path.join(parent, 'targets')
  fs.mkdirSync(path.join(controller, 'src'), { recursive: true })
  fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.ai', 'harness', 'results'), { recursive: true })
  fs.mkdirSync(path.join(controller, '.ai', 'framework-context'), { recursive: true })
  fs.mkdirSync(path.join(controller, 'build'), { recursive: true })
  fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
  fs.writeFileSync(path.join(controller, 'src', 'modules.ts'), 'export default []\n')
  fs.writeFileSync(path.join(controller, '.ai', 'harness', 'cases.json'), '[]\n')
  fs.writeFileSync(path.join(controller, '.ai', 'harness', 'results', 'old.json'), '{}\n')
  fs.writeFileSync(path.join(controller, '.ai', 'framework-context', 'old.txt'), 'context\n')
  fs.writeFileSync(path.join(controller, 'build', 'old.js'), 'build\n')
  fs.writeFileSync(path.join(controller, 'README.md'), 'fresh\n')
  fs.writeFileSync(path.join(controller, '.env.example'), 'DATABASE_URL=postgres://localhost/example\n')
  try {
    const manifest = release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002', 'OMH-003'] })
    assert.deepEqual(Object.keys(manifest.targets), ['OMH-002', 'OMH-003'])
    const target = manifest.targets['OMH-002']
    assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'fresh\n')
    assert.equal(fs.existsSync(path.join(target, 'build')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'results')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'framework-context')), false)
    assert.equal(fs.readFileSync(path.join(target, '.env.example'), 'utf8'), 'DATABASE_URL=postgres://localhost/example\n')
    assert.equal(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink(), true)
    assert.equal(fs.realpathSync(path.join(target, 'node_modules')), fs.realpathSync(path.join(controller, 'node_modules')))
    fs.writeFileSync(path.join(target, 'README.md'), 'changed\n')
    assert.equal(fs.readFileSync(path.join(controller, 'README.md'), 'utf8'), 'fresh\n')
    assert.throws(() => release.resolvePreparationRoot(prepareRoot, controller), /must be empty/)
    assert.throws(() => release.resolvePreparationRoot(path.join(controller, 'unsafe-targets'), controller), /separate from the controller/)
    assert.throws(() => release.resolvePreparationRoot(path.join(controller, '..targets'), controller), /separate from the controller/)
    const linkedRoot = path.join(parent, 'linked-targets')
    fs.symlinkSync(controller, linkedRoot, 'dir')
    assert.throws(() => release.resolvePreparationRoot(linkedRoot, controller), /regular directory/)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
    fs.rmSync(controller, { recursive: true, force: true })
  }
})

test('automatic target preparation rejects local environment, credential, and private-key files without copying them', { skip: process.platform === 'win32' }, () => {
  const sensitiveFiles = ['.env', '.env.local', 'config/service-account-credentials.json', 'certs/signing.key']
  for (const relative of sensitiveFiles) {
    const controller = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sensitive-source-')))
    const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sensitive-target-')))
    const prepareRoot = path.join(parent, 'targets')
    fs.mkdirSync(path.join(controller, 'src'), { recursive: true })
    fs.mkdirSync(path.join(controller, 'node_modules', 'example'), { recursive: true })
    fs.mkdirSync(path.join(controller, '.ai', 'harness'), { recursive: true })
    fs.mkdirSync(path.dirname(path.join(controller, relative)), { recursive: true })
    fs.writeFileSync(path.join(controller, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(controller, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(controller, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.writeFileSync(path.join(controller, relative), 'must-not-be-copied\n')
    try {
      assert.throws(
        () => release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002'] }),
        /sanitized fresh scaffold/,
        relative,
      )
      assert.equal(fs.existsSync(prepareRoot), false, relative)
    } finally {
      fs.rmSync(parent, { recursive: true, force: true })
      fs.rmSync(controller, { recursive: true, force: true })
    }
  }
})

test('externally prepared targets must be realpath-disjoint from the controller and every other target', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-disjoint-')))
  const controller = path.join(parent, 'controller')
  const outside = path.join(parent, 'outside')
  fs.mkdirSync(controller)
  fs.mkdirSync(outside)
  const sentinel = path.join(outside, 'sentinel.txt')
  fs.writeFileSync(sentinel, 'outside-original')
  try {
    const controllerOverlap = releaseInputs()
    controllerOverlap.targetsManifest.targets = {
      'OMH-002': path.join(controller, 'nested-target'),
      'OMH-003': parent,
    }
    const controllerPlan = release.buildReleasePlan({ ...controllerOverlap, root: controller, targetsMayNotExist: true })
    assert.deepEqual(controllerPlan.coverage.writable.invalidTargetCaseIds, ['OMH-002', 'OMH-003'])

    const targetOverlap = releaseInputs()
    targetOverlap.targetsManifest.targets = {
      'OMH-002': path.join(outside, 'target'),
      'OMH-003': path.join(outside, 'target', 'nested'),
    }
    const targetPlan = release.buildReleasePlan({ ...targetOverlap, root: controller, targetsMayNotExist: true })
    assert.deepEqual(targetPlan.coverage.writable.duplicateTargetCaseIds, ['OMH-002', 'OMH-003'])
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'outside-original')
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('externally prepared targets reject regular nested dependency trees before execution', () => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-nested-deps-')))
  const controller = path.join(parent, 'controller')
  const targets = ['OMH-002', 'OMH-003'].map((caseId) => path.join(parent, caseId))
  fs.mkdirSync(path.join(controller, 'node_modules'), { recursive: true })
  for (const target of targets) {
    fs.mkdirSync(path.join(target, 'src'), { recursive: true })
    fs.mkdirSync(path.join(target, '.ai', 'harness'), { recursive: true })
    fs.mkdirSync(path.join(target, 'node_modules', 'example'), { recursive: true })
    fs.writeFileSync(path.join(target, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(target, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(target, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.writeFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'original\n')
  }
  try {
    const input = releaseInputs()
    input.targetsManifest.targets = { 'OMH-002': targets[0], 'OMH-003': targets[1] }
    const plan = release.buildReleasePlan({ ...input, root: controller })
    assert.deepEqual(plan.coverage.writable.invalidTargetCaseIds, ['OMH-002', 'OMH-003'])
    for (const target of targets) {
      assert.equal(fs.readFileSync(path.join(target, 'node_modules', 'example', 'sentinel.js'), 'utf8'), 'original\n')
    }
  } finally { fs.rmSync(parent, { recursive: true, force: true }) }
})

test('every target validation command runs and failures retain actionable sanitized diagnostics', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-')))
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.appendFileSync('calls.txt', process.argv[2] + '\\n')
if (process.argv[2] === 'lint') { console.error('lint rule failed in ' + process.cwd()); process.exit(7) }
`)
  fs.chmodSync(fakeYarn, 0o755)
  const commands = ['generate', 'typecheck', 'lint', 'build'].map((name) => ({
    id: `target-validation:OMH-002:${name}`, kind: 'target-validation', caseId: 'OMH-002', command: `yarn ${name}`,
  }))
  try {
    const results = release.runTargetValidationSteps({ steps: commands, target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn })
    assert.deepEqual(fs.readFileSync(path.join(target, 'calls.txt'), 'utf8').trim().split('\n'), ['generate', 'typecheck', 'lint', 'build'])
    assert.deepEqual(results.map((entry) => entry.status), ['pass', 'pass', 'fail', 'pass'])
    assert.equal(results[2].command, 'yarn lint')
    assert.match(results[2].sanitizedError, /lint rule failed in <redacted-path>/)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('target validation hides host secrets and denies out-of-root reads and writes', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-contained-')))
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-secret-')))
  const secret = path.join(outside, 'secret.txt')
  const escapedWrite = path.join(outside, 'escaped.txt')
  fs.writeFileSync(secret, 'do-not-read')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
if (process.env.FAKE_PROVIDER_SECRET) process.exit(21)
try { fs.readFileSync(${JSON.stringify(secret)}, 'utf8'); process.exit(22) } catch (error) { if (!['EPERM', 'EACCES', 'ENOENT'].includes(error.code)) throw error }
try { fs.writeFileSync(${JSON.stringify(escapedWrite)}, 'escaped'); process.exit(23) } catch (error) { if (!['EPERM', 'EACCES', 'ENOENT', 'EROFS'].includes(error.code)) throw error }
fs.writeFileSync('contained.txt', 'ok')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = 'must-not-cross-boundary'
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target, outside], yarnCommand: fakeYarn })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.equal(fs.readFileSync(path.join(target, 'contained.txt'), 'utf8'), 'ok')
    assert.equal(fs.readFileSync(secret, 'utf8'), 'do-not-read')
    assert.equal(fs.existsSync(escapedWrite), false)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(outside, { recursive: true, force: true })
  }
})

test('minimal validation environment omits provider secrets and process diagnostics redact inherited scalars and URL userinfo', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-redaction-')))
  const environmentRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-env-')))
  const scalar = 'provider-scalar-must-not-persist'
  const databaseUrl = 'postgres://release-user:database-password@db.example.test:5432/app'
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
if (process.env.FAKE_PROVIDER_SECRET) process.exit(21)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
process.exit(7)
`)
  fs.chmodSync(fakeYarn, 0o755)
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = scalar
  try {
    const minimal = release.createMinimalValidationEnvironment(environmentRoot)
    assert.equal(minimal.env.FAKE_PROVIDER_SECRET, undefined)
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:lint', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn lint' }],
      target,
      timeout: 10_000,
      roots: [target, environmentRoot],
      yarnCommand: fakeYarn,
    })
    assert.equal(result.status, 'fail')
    assert.equal(result.exitStatus, 7)
    assert.doesNotMatch(result.sanitizedError, /provider-scalar-must-not-persist|release-user|database-password/)
    assert.match(result.sanitizedError, /postgres:\/\/<redacted-secret>@db\.example\.test/)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(environmentRoot, { recursive: true, force: true })
  }
})

test('target validation cannot mutate nested files in shared dependencies', { skip: !targetSandboxAvailable }, () => {
  const controllerDependencies = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-shared-deps-')))
  const nested = path.join(controllerDependencies, 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-deps-')))
  fs.symlinkSync(controllerDependencies, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target, controllerDependencies], yarnCommand: fakeYarn })
    assert.equal(result.status, 'fail')
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(controllerDependencies, { recursive: true, force: true })
  }
})

test('target validation fails closed when a regular dependency tree overlaps the writable target', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-validation-nested-deps-')))
  const nested = path.join(target, 'node_modules', 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
fs.writeFileSync('MODEL_RAN', 'unsafe')
`)
  fs.chmodSync(fakeYarn, 0o755)
  const step = { id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }
  try {
    const [result] = release.runTargetValidationSteps({ steps: [step], target, timeout: 10_000, roots: [target], yarnCommand: fakeYarn })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /writable target node_modules must resolve outside the writable target/)
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
    assert.equal(fs.existsSync(path.join(target, 'MODEL_RAN')), false)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('sandbox read-only descendants override a writable parent root', { skip: !targetSandboxAvailable }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-sandbox-nested-readonly-')))
  const dependencyRoot = path.join(target, 'node_modules')
  const nested = path.join(dependencyRoot, 'example', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(nested, 'original')
  const probe = path.join(target, 'sandbox-probe')
  fs.writeFileSync(probe, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync('allowed.txt', 'allowed')
fs.writeFileSync('node_modules/example/nested.js', 'tampered')
`)
  fs.chmodSync(probe, 0o755)
  try {
    const invocation = executionSandbox.sandboxedInvocation({
      command: probe,
      cwd: target,
      writableRoots: [target],
      readOnlyRoots: [dependencyRoot],
      networkMode: 'none',
      env: process.env,
    })
    const result = spawnSync(invocation.command, invocation.args, { cwd: invocation.cwd, env: invocation.env, encoding: 'utf8' })
    assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(fs.readFileSync(path.join(target, 'allowed.txt'), 'utf8'), 'allowed')
    assert.equal(fs.readFileSync(nested, 'utf8'), 'original')
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('Linux sandbox namespaces are private by default and host networking is shared only when explicitly requested', () => {
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('none'), ['--unshare-all'])
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('loopback'), ['--unshare-all'])
  assert.deepEqual(executionSandbox.linuxNamespaceArgs('all'), ['--unshare-all', '--share-net'])
  assert.throws(() => executionSandbox.linuxNamespaceArgs('provider'), /invalid sandbox network mode/)
})

test('release target fingerprints bind empty directories and file or directory mode changes', { skip: process.platform === 'win32' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-target-fingerprint-')))
  const source = path.join(target, 'source.ts')
  const directory = path.join(target, 'existing')
  fs.writeFileSync(source, 'export const value = 1\n')
  fs.mkdirSync(directory)
  try {
    const initial = release.targetContentFingerprint(target)
    fs.chmodSync(source, 0o755)
    const fileMode = release.targetContentFingerprint(target)
    assert.notEqual(fileMode, initial)
    fs.chmodSync(directory, 0o700)
    const directoryMode = release.targetContentFingerprint(target)
    assert.notEqual(directoryMode, fileMode)
    fs.mkdirSync(path.join(target, 'UNDECLARED_EMPTY'))
    assert.notEqual(release.targetContentFingerprint(target), directoryMode)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('macOS validation resolves a lexical PATH node launcher without authorizing a broad temporary parent', { skip: process.platform !== 'darwin' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-target-')))
  const launcherBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-parent-')))
  const launcherParent = path.join(launcherBase, 'xfs-deadbeef')
  fs.mkdirSync(launcherParent)
  const launcher = path.join(launcherParent, 'node')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(fs.realpathSync(process.execPath))}  "$@"\n`)
  fs.chmodSync(launcher, 0o755)
  fs.writeFileSync(fakeYarn, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("xfs-ok.txt", "ok")\n')
  fs.chmodSync(fakeYarn, 0o755)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target, timeout: 10_000, roots: [target, launcherParent], yarnCommand: fakeYarn,
      pathValue: `${launcherParent}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.equal(fs.readFileSync(path.join(target, 'xfs-ok.txt'), 'utf8'), 'ok')
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(launcherBase, { recursive: true, force: true })
  }
})

test('macOS validation rejects a lookalike XFS node wrapper', { skip: process.platform !== 'darwin' }, () => {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-reject-target-')))
  const launcherBase = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-xfs-reject-parent-')))
  const launcherParent = path.join(launcherBase, 'xfs-badc0de')
  fs.mkdirSync(launcherParent)
  const launcher = path.join(launcherParent, 'node')
  const fakeYarn = path.join(target, 'fake-yarn')
  fs.writeFileSync(launcher, `#!/bin/sh\nexec ${JSON.stringify(fs.realpathSync(process.execPath))} "$@"\n`)
  fs.chmodSync(launcher, 0o755)
  fs.writeFileSync(fakeYarn, '#!/usr/bin/env node\nrequire("node:fs").writeFileSync("unsafe.txt", "ran")\n')
  fs.chmodSync(fakeYarn, 0o755)
  try {
    const [result] = release.runTargetValidationSteps({
      steps: [{ id: 'target-validation:OMH-002:build', kind: 'target-validation', caseId: 'OMH-002', command: 'yarn build' }],
      target, timeout: 10_000, roots: [target, launcherParent], yarnCommand: fakeYarn,
      pathValue: `${launcherParent}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 'fail')
    assert.equal(fs.existsSync(path.join(target, 'unsafe.txt')), false)
  } finally {
    fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(launcherBase, { recursive: true, force: true })
  }
})

function stageGeneratedTestTarget(): string {
  const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-generated-tests-')))
  fs.mkdirSync(path.join(target, 'src', 'modules'), { recursive: true })
  fs.mkdirSync(path.join(target, '.ai', 'qa', 'tests'), { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), '{"name":"generated-test-target","private":true,"type":"module"}\n')
  fs.writeFileSync(path.join(target, 'jest.config.cjs'), 'module.exports = { testEnvironment: "node", transform: {} }\n')
  fs.writeFileSync(path.join(target, '.ai', 'qa', 'tests', 'playwright.config.ts'), `
import { defineConfig } from '@playwright/test'
export default defineConfig({ testDir: ${JSON.stringify(target)}, timeout: 10000, retries: 0, workers: 1, use: { headless: true } })
`)
  fs.symlinkSync(monorepoNodeModules, path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  return target
}

function writeGeneratedTest(target: string, relative: string, source: string): void {
  const file = path.join(target, relative)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, source)
}

function generatedTestStep(caseId: string, testRunner: string, artifact: string, network: string): any {
  const contract = release.generatedTestExecutionContract({ runner: testRunner, artifact })
  return { id: `generated-test:${caseId}:${testRunner}`, kind: 'generated-test', caseId, testRunner, artifact, network, ...contract }
}

test('generated Jest tests run through the direct fixed runner with a read-only target and no network', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({
    name: 'generated-test-target', private: true, type: 'module',
    scripts: { test: 'node -e "require(\\"node:fs\\").writeFileSync(\\"TARGET_SCRIPT_RAN\\",\\"unsafe\\")"' },
  }))
  writeGeneratedTest(target, artifact, `
test('already approved', () => expect(() => { throw new Error('already approved') }).toThrow('already approved'))
test('requester', () => expect(() => { throw new Error('requester') }).toThrow('requester'))
test('injected failure rolls back', () => expect(0).toBe(0))
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
    assert.equal(result.exitStatus, 0)
    assert.equal(result.executor, 'node')
    assert.equal(result.cliPackage, 'jest')
    assert.match(result.cliSha256, /^[a-f0-9]{64}$/)
    assert.deepEqual(result.argv, [
      '<resolved-cli>', '--config', 'jest.config.cjs', '--runInBand', '--runTestsByPath', artifact,
      '--cacheDirectory', '<isolated-temp>/jest-cache',
    ])
    assert.equal(result.command, `node ${result.argv.join(' ')}`)
    assert.equal(fs.existsSync(path.join(target, 'TARGET_SCRIPT_RAN')), false)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated test code cannot mutate the read-only target', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  const packageBefore = fs.readFileSync(path.join(target, 'package.json'), 'utf8')
  writeGeneratedTest(target, artifact, `
import fs from 'node:fs'
test('cannot rewrite trusted target inputs', () => { fs.writeFileSync('package.json', '{"tampered":true}') })
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'fail')
    assert.equal(fs.readFileSync(path.join(target, 'package.json'), 'utf8'), packageBefore)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated tests reject a fictional package-script command instead of attesting it', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/quote_approval/commands/__tests__/approve-quote.test.ts'
  writeGeneratedTest(target, artifact, `test('would pass', () => expect(true).toBe(true))\n`)
  const step = generatedTestStep('OMH-163', 'jest', artifact, 'none')
  step.command = `yarn test --runInBand --runTestsByPath ${artifact}`
  try {
    const result = release.runGeneratedTestStep({ step, target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'fail')
    assert.match(result.sanitizedError, /fixed direct controller contract/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated API Playwright tests can use isolated loopback but cannot reach an external address', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/customer_api/__integration__/TC-API-CUSTOMERS-001.spec.ts'
  writeGeneratedTest(target, artifact, `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('loopback only', async ({ request }) => {
  const server = createServer((_request, response) => response.end('ok'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    expect(await (await request.get('http://127.0.0.1:' + address.port)).text()).toBe('ok')
    await expect(request.get('http://1.1.1.1', { timeout: 500 })).rejects.toThrow()
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-164', 'playwright-api', artifact, 'loopback'), target, timeout: 30_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated browser Playwright tests launch the exact bounded headless runtime', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'
  writeGeneratedTest(target, artifact, `
import { createServer } from 'node:http'
import { expect, test } from '@playwright/test'
test('real browser', async ({ page }) => {
  const server = createServer((_request, response) => response.end('<button>Approve quote</button><p role="status">Ready</p>'))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('no address')
    await page.goto('http://127.0.0.1:' + address.port)
    await expect(page.getByRole('button', { name: 'Approve quote' })).toBeVisible()
    await expect(page.getByRole('status')).toHaveText('Ready')
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})
`)
  try {
    const result = release.runGeneratedTestStep({ step: generatedTestStep('OMH-165', 'playwright-browser', artifact, 'loopback'), target, timeout: 45_000, roots: [target] })
    assert.equal(result.status, 'pass', result.sanitizedError)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('generated-test execution fails closed for missing runtimes and browser prerequisites', { skip: !targetSandboxAvailable }, () => {
  const target = stageGeneratedTestTarget()
  const artifact = 'src/modules/portal_quote_approval/__integration__/TC-PORTAL-QUOTE-001.spec.ts'
  writeGeneratedTest(target, artifact, "import { test } from '@playwright/test'; test('x', async () => {})\n")
  try {
    const browserFailure = release.runGeneratedTestStep({
      step: generatedTestStep('OMH-165', 'playwright-browser', artifact, 'loopback'), target, timeout: 10_000, roots: [target],
      browserRuntimeResolver: () => { throw new Error('browser runtime absent') },
    })
    assert.equal(browserFailure.status, 'fail')
    assert.match(browserFailure.sanitizedError, /browser runtime absent/)
    fs.rmSync(path.join(target, 'node_modules'))
    fs.mkdirSync(path.join(target, 'node_modules'))
    const runtimeFailure = release.runGeneratedTestStep({
      step: generatedTestStep('OMH-163', 'jest', artifact, 'none'), target, timeout: 10_000, roots: [target],
    })
    assert.equal(runtimeFailure.status, 'fail')
    assert.match(runtimeFailure.sanitizedError, /Cannot find module|CLI/)
  } finally { fs.rmSync(target, { recursive: true, force: true }) }
})

test('the suite-level dependency fingerprint detects nested package file mutations', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-dependency-fingerprint-')))
  const nested = path.join(root, 'node_modules', 'example', 'lib', 'nested.js')
  fs.mkdirSync(path.dirname(nested), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{}\n')
  fs.writeFileSync(nested, 'original\n')
  try {
    const before = release.dependencyContentFingerprint(root)
    fs.writeFileSync(nested, 'mutated\n')
    const after = release.dependencyContentFingerprint(root)
    assert.notEqual(after, before)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('standalone template exposes the documented one-command release entrypoint', () => {
  const template = JSON.parse(fs.readFileSync(new URL('../../template/package.json.template', import.meta.url), 'utf8'))
  assert.equal(template.scripts['harness:release'], 'node ./scripts/run-agent-harness-release.mjs')
})

test('release preflight names newly writable business coverage instead of assuming a fixed matrix size', () => {
  const input = releaseInputs()
  input.cases.push({
    id: 'OMH-004', family: 'business', mode: 'one-shot', evaluationKind: 'implementation',
    fixture: { scaffold: 'fresh-standalone', setup: ['fixture:missing-business'] },
    oracle: { validatorIds: [], expectedArtifacts: [] },
  })
  input.registry.catalog.expectedCaseCount = 4
  const plan = release.buildReleasePlan(input)
  assert.deepEqual(plan.coverage.writable.expectedCaseIds, ['OMH-002', 'OMH-003', 'OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingMatrixCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingTargetCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingFixtureCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.writable.missingOracleCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.review.missingMatrixCaseIds, ['OMH-004'])
  assert.deepEqual(plan.coverage.registry.missingWritableCaseIds, ['OMH-004'])
  assert.ok(plan.violations.every((entry: string) => entry.includes('OMH-004') || entry.includes('live routing') || entry.includes('exactly once in catalog order')))
})

test('release preflight requires the explicit om-code-review gate', () => {
  const input = releaseInputs()
  input.releaseMatrix.generatedCodeReview.skill = 'generic-review'
  const plan = release.buildReleasePlan(input)
  assert.ok(plan.violations.includes('generated-code review must explicitly use om-code-review'))
})

test('quality metrics expose first-pass, correction, context, review, and categorized misuse rates', () => {
  const metrics = release.aggregateQualityMetrics([
    { status: 'pass', attempts: 1, corrections: 0, violations: [], actualContext: { estimatedTokens: 100, estimatedInitialTokens: 40 } },
    { status: 'pass', attempts: 2, corrections: 1, violations: ['unsafe out-of-root context read'], actualContext: { estimatedTokens: 300, estimatedInitialTokens: 80 } },
    { status: 'fail', attempts: 1, corrections: 0, violations: ['missing route module-data'], verdict: 'request changes', actualContext: { estimatedTokens: 200, estimatedInitialTokens: 60 } },
  ])
  assert.deepEqual(metrics.outcomes, { results: 3, passed: 2, failed: 1 })
  assert.deepEqual(metrics.firstPass, { eligibleResults: 3, passedFirstPass: 1, ratePct: 33.33 })
  assert.deepEqual(metrics.corrections, { total: 1, resultsWithCorrections: 1, ratePct: 33.33 })
  assert.equal(metrics.context.averageEstimatedTokens, 200)
  assert.equal(metrics.context.p95EstimatedTokens, 300)
  assert.deepEqual(metrics.misuse.byCategory, { safety: 1, contract: 1, execution: 0, quality: 0 })
  assert.equal(metrics.reviewVerdicts.requestChanges, 1)
})

test('release command fails closed before execution and stores a sanitized exact coverage report', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-controller-')))
  const harness = path.join(root, '.ai', 'harness')
  fs.mkdirSync(path.join(harness, 'fixtures'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  const input = releaseInputs()
  input.targetsManifest = { schemaVersion: 1, targets: {} }
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
  fs.copyFileSync(targetValidationSchema, path.join(harness, 'target-validation-result.schema.json'))
  fs.writeFileSync(path.join(harness, 'fixtures', 'index.json'), JSON.stringify(input.fixtures))
  fs.writeFileSync(path.join(harness, 'fixtures', 'seeds.json'), JSON.stringify(input.seeds))
  const targetsPath = path.join(root, 'targets-secret.json')
  fs.writeFileSync(targetsPath, JSON.stringify(input.targetsManifest))
  try {
    const run = spawnSync(process.execPath, [
      releaseScript, '--root', root, '--writable-targets', targetsPath, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stderr, /Release preflight failed/)
    const resultDirectory = path.join(harness, 'results')
    const [file] = fs.readdirSync(resultDirectory)
    const report = JSON.parse(fs.readFileSync(path.join(resultDirectory, file), 'utf8'))
    assert.equal(report.status, 'fail')
    assert.deepEqual(report.coverage.writable.missingTargetCaseIds, ['OMH-002', 'OMH-003'])
    assert.deepEqual(report.steps, [])
    assert.equal(report.metrics.outcomes.results, 0)
    assert.equal(fs.statSync(path.join(resultDirectory, file)).mode & 0o077, 0)
    assert.doesNotMatch(JSON.stringify(report), new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('persisted foundation process diagnostics use a minimal environment and redact environment scalars plus URL userinfo', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-release-foundation-redaction-')))
  const harness = path.join(root, '.ai', 'harness')
  const fakeBin = path.join(root, 'fake-bin')
  const scalar = 'foundation-provider-secret-must-not-persist'
  const databaseUrl = 'postgres://foundation-user:foundation-password@db.example.test:5432/app'
  fs.mkdirSync(path.join(harness, 'fixtures'), { recursive: true })
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.mkdirSync(fakeBin)
  const input = releaseInputs()
  const targets: Record<string, string> = {}
  for (const caseId of ['OMH-002', 'OMH-003']) {
    const target = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `om-release-foundation-${caseId}-`)))
    fs.mkdirSync(path.join(target, 'src'), { recursive: true })
    fs.mkdirSync(path.join(target, '.ai', 'harness'), { recursive: true })
    fs.writeFileSync(path.join(target, 'package.json'), '{}\n')
    fs.writeFileSync(path.join(target, 'src', 'modules.ts'), 'export default []\n')
    fs.writeFileSync(path.join(target, '.ai', 'harness', 'cases.json'), '[]\n')
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
    targets[caseId] = target
  }
  input.targetsManifest = { schemaVersion: 1, targets }
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
  fs.copyFileSync(targetValidationSchema, path.join(harness, 'target-validation-result.schema.json'))
  fs.writeFileSync(path.join(harness, 'fixtures', 'index.json'), JSON.stringify(input.fixtures))
  fs.writeFileSync(path.join(harness, 'fixtures', 'seeds.json'), JSON.stringify(input.seeds))
  const reviewFiles = [
    '.agents/skills/om-code-review/SKILL.md',
    '.agents/skills/om-code-review/references/agentic-setup.md',
    '.agents/skills/om-code-review/references/output-format.md',
    '.agents/skills/om-code-review/references/review-checklist.md',
    '.agents/skills/om-code-review/references/rules.md',
    '.agents/skills/.om-external-ownership.json',
  ]
  for (const relative of reviewFiles) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
    fs.writeFileSync(path.join(root, relative), '{}\n')
  }
  fs.writeFileSync(path.join(root, 'scripts', 'evaluate-agent-harness.mjs'), `
if (process.env.FAKE_PROVIDER_SECRET || process.env.DATABASE_URL) process.exit(21)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
console.log('PASS OMH-001\\nPASS OMH-002\\nPASS OMH-003')
`)
  const fakeYarn = path.join(fakeBin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  fs.writeFileSync(fakeYarn, `#!/usr/bin/env node
if (process.env.FAKE_PROVIDER_SECRET || process.env.DATABASE_URL) process.exit(22)
console.error(${JSON.stringify(`${scalar} ${databaseUrl}`)})
if (process.argv[2] === 'lint') process.exit(7)
`)
  fs.chmodSync(fakeYarn, 0o755)
  const targetsPath = path.join(root, 'targets.json')
  fs.writeFileSync(targetsPath, JSON.stringify(input.targetsManifest))
  try {
    const run = spawnSync(process.execPath, [
      releaseScript, '--root', root, '--writable-targets', targetsPath, '--acknowledge-writes',
    ], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`,
        FAKE_PROVIDER_SECRET: scalar,
        DATABASE_URL: databaseUrl,
      },
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const resultDirectory = path.join(harness, 'results')
    const reportFile = fs.readdirSync(resultDirectory).find((entry) => entry.endsWith('-release-suite.json'))
    assert.ok(reportFile)
    const reportText = fs.readFileSync(path.join(resultDirectory, reportFile), 'utf8')
    const report = JSON.parse(reportText)
    assert.equal(report.steps.find((step: any) => step.id === 'deterministic:all').status, 'pass')
    assert.equal(report.steps.find((step: any) => step.id === 'validation:lint').exitStatus, 7)
    assert.doesNotMatch(reportText, /foundation-provider-secret|foundation-user|foundation-password/)
    assert.match(reportText, /postgres:\/\/<redacted-secret>@db\.example\.test/)
  } finally {
    for (const target of Object.values(targets)) fs.rmSync(target, { recursive: true, force: true })
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('release sanitization removes controller paths, environment scalars, URL userinfo, and common secret forms', () => {
  const root = path.join(os.tmpdir(), 'sensitive-release-root')
  const scalar = 'fake-provider-value-which-must-not-persist'
  const previous = process.env.FAKE_PROVIDER_SECRET
  process.env.FAKE_PROVIDER_SECRET = scalar
  try {
    const sanitized = release.sanitizeReportText([
      root,
      'token=abc123supersecret',
      'ghp_1234567890abcdefghij',
      scalar,
      'postgres://database-user:database-password@db.example.test:5432/app',
      'https://http-user:http-password@example.test/private',
    ].join(' '), [root])
    assert.doesNotMatch(sanitized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(sanitized, /abc123supersecret|ghp_1234567890abcdefghij|fake-provider-value|database-user|database-password|http-user|http-password/)
    assert.match(sanitized, /postgres:\/\/<redacted-secret>@db\.example\.test/)
    assert.match(sanitized, /https:\/\/<redacted-secret>@example\.test/)
  } finally {
    if (previous === undefined) delete process.env.FAKE_PROVIDER_SECRET
    else process.env.FAKE_PROVIDER_SECRET = previous
  }
})
