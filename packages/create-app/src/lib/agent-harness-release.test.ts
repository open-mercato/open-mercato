import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

const releaseScript = fileURLToPath(new URL('../../agentic/shared/scripts/run-agent-harness-release.mjs', import.meta.url))
const releaseSchema = fileURLToPath(new URL('../../agentic/shared/ai/harness/release-result.schema.json', import.meta.url))
const release = await import(pathToFileURL(releaseScript).href) as {
  buildReleasePlan: (input: Record<string, unknown>) => any
  aggregateQualityMetrics: (results: any[]) => any
  sanitizeReportText: (value: string, roots?: string[]) => string
}

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
    'fixture:OMH-002', 'writable:OMH-002', 'review:OMH-002',
    'fixture:OMH-003', 'writable:OMH-003',
  ])
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
  const input = releaseInputs()
  input.targetsManifest = { schemaVersion: 1, targets: {} }
  fs.writeFileSync(path.join(harness, 'cases.json'), JSON.stringify(input.cases))
  fs.writeFileSync(path.join(harness, 'validators.json'), JSON.stringify(input.registry))
  fs.writeFileSync(path.join(harness, 'release-matrix.json'), JSON.stringify(input.releaseMatrix))
  fs.copyFileSync(releaseSchema, path.join(harness, 'release-result.schema.json'))
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
