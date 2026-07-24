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
const release = await import(pathToFileURL(releaseScript).href) as {
  buildReleasePlan: (input: Record<string, unknown>) => any
  aggregateQualityMetrics: (results: any[]) => any
  sanitizeReportText: (value: string, roots?: string[]) => string
  prepareWritableTargets: (input: { root: string; prepareRoot: string; caseIds: string[] }) => { schemaVersion: number; targets: Record<string, string> }
  resolvePreparationRoot: (requested: string, controllerRoot: string) => string
  dependencyContentFingerprint: (appRoot: string) => string
  runTargetValidationSteps: (input: { steps: any[]; target: string; timeout: number; roots: string[]; yarnCommand: string }) => any[]
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
      skill: 'om-code-review',
      caseIds: ['OMH-002'],
      runners: { codex: { modelSelector: 'default' }, claude: { modelSelector: 'sonnet' } },
    },
  }
  const fixtures = { fixtures: { module: {}, regression: {} } }
  const seeds = { fixtures: { module: {}, regression: {} } }
  const targetsManifest = { schemaVersion: 1, targets: { 'OMH-002': targetA, 'OMH-003': targetB } }
  return { cases, registry, releaseMatrix, fixtures, seeds, targetsManifest }
}

test('release plan derives every count and command from catalog and matrix data', () => {
  const plan = release.buildReleasePlan(releaseInputs())
  assert.deepEqual(plan.violations, [])
  assert.deepEqual(plan.catalog, { caseCount: 3, writableCaseCount: 2, reviewEligibleCaseCount: 1 })
  assert.deepEqual(plan.coverage.deterministic.configuredCaseIds, ['OMH-001', 'OMH-002', 'OMH-003'])
  assert.deepEqual(plan.coverage.writable.configuredCaseIds, ['OMH-002', 'OMH-003'])
  assert.deepEqual(plan.coverage.review.configuredCaseIds, ['OMH-002'])
  assert.deepEqual(plan.steps.map((step: { id: string }) => step.id), [
    'deterministic:all',
    'validation:generate', 'validation:typecheck', 'validation:lint', 'validation:build',
    'routing:codex', 'routing:claude',
    'fixture:OMH-002', 'writable:OMH-002',
    'target-validation:OMH-002:generate', 'target-validation:OMH-002:typecheck', 'target-validation:OMH-002:lint', 'target-validation:OMH-002:build',
    'review:OMH-002',
    'fixture:OMH-003', 'writable:OMH-003',
    'target-validation:OMH-003:generate', 'target-validation:OMH-003:typecheck', 'target-validation:OMH-003:lint', 'target-validation:OMH-003:build',
  ])
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
  try {
    const manifest = release.prepareWritableTargets({ root: controller, prepareRoot, caseIds: ['OMH-002', 'OMH-003'] })
    assert.deepEqual(Object.keys(manifest.targets), ['OMH-002', 'OMH-003'])
    const target = manifest.targets['OMH-002']
    assert.equal(fs.readFileSync(path.join(target, 'README.md'), 'utf8'), 'fresh\n')
    assert.equal(fs.existsSync(path.join(target, 'build')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'results')), false)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'framework-context')), false)
    assert.equal(fs.lstatSync(path.join(target, 'node_modules')).isSymbolicLink(), true)
    assert.equal(fs.realpathSync(path.join(target, 'node_modules')), fs.realpathSync(path.join(controller, 'node_modules')))
    fs.writeFileSync(path.join(target, 'README.md'), 'changed\n')
    assert.equal(fs.readFileSync(path.join(controller, 'README.md'), 'utf8'), 'fresh\n')
    assert.throws(() => release.resolvePreparationRoot(prepareRoot, controller), /must be empty/)
    assert.throws(() => release.resolvePreparationRoot(path.join(controller, 'unsafe-targets'), controller), /separate from the controller/)
    const linkedRoot = path.join(parent, 'linked-targets')
    fs.symlinkSync(controller, linkedRoot, 'dir')
    assert.throws(() => release.resolvePreparationRoot(linkedRoot, controller), /regular directory/)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
    fs.rmSync(controller, { recursive: true, force: true })
  }
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
  assert.ok(plan.violations.every((entry: string) => entry.includes('OMH-004') || entry.includes('live routing')))
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

test('release sanitization removes controller paths and common secret forms', () => {
  const root = path.join(os.tmpdir(), 'sensitive-release-root')
  const sanitized = release.sanitizeReportText(`${root} token=abc123supersecret ghp_1234567890abcdefghij`, [root])
  assert.doesNotMatch(sanitized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.doesNotMatch(sanitized, /abc123supersecret|ghp_1234567890abcdefghij/)
})
