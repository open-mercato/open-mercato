import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'
import { classify, loadConfig, main, readFullSuitePattern, shouldRerunAfterLabelChange } from '../ci/batch-candidate.mjs'

const ciWorkflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const batchWorkflow = parse(fs.readFileSync(new URL('../../.github/workflows/batch-pr-ci.yml', import.meta.url), 'utf8'))
const rerunWorkflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci-label-rerun.yml', import.meta.url), 'utf8'))
const batchDoc = fs.readFileSync(new URL('../../.ai/docs/batch-branches.md', import.meta.url), 'utf8')
const scriptPath = fileURLToPath(new URL('../ci/batch-candidate.mjs', import.meta.url))
const config = loadConfig()
const fullSuitePattern = ciWorkflow.env.FULL_SUITE_PATTERN
const moduleFile = 'packages/core/src/modules/customers/api/people.ts'

function candidatePr(overrides = {}) {
  return {
    config,
    eventName: 'pull_request',
    baseRef: 'main',
    author: 'pkarw',
    sameRepo: true,
    labels: ['feature'],
    changedFiles: [moduleFile],
    fullSuitePattern,
    forceFullSuite: false,
    ...overrides,
  }
}

const heavyJobs = ['prepare', 'test', 'core-timezone', 'documents-multi-instance', 'ephemeral-integration', 'merge-coverage', 'docker-build']
const cheapJobs = ['lint', 'ds-lint', 'audit-scope', 'audit']

test('routing config holds the batch-candidate authors and excluded labels', () => {
  assert.deepEqual(config.authors, ['haxiorz', 'AHKSammich', 'pkarw', 'adeptofvoltron', 'andrzejewsky', 'wojciechszyjka'])
  assert.deepEqual(config.excludedLabels, ['needs-human-qa', 'security', 'enterprise', 'backport', 'risk-high'])
  assert.equal(config.candidateLabel, null)
  assert.equal(config.forceFullLabel, 'ci-full')
  assert.equal(config.baseBranch, 'main')
})

test('the classifier reads the same FULL_SUITE_PATTERN ci.yml defines', () => {
  assert.equal(readFullSuitePattern(), fullSuitePattern)
  assert.ok(new RegExp(fullSuitePattern).test('packages/shared/src/lib/boolean.ts'))
})

test('candidate author on a same-repo PR into main gets the fast gate', () => {
  const result = classify(candidatePr())
  assert.equal(result.candidate, true)
  assert.equal(result.forceFull, false)
})

test('author matching ignores login case', () => {
  assert.equal(classify(candidatePr({ author: 'ahksammich' })).candidate, true)
})

test('non-candidate author runs the normal suite', () => {
  assert.equal(classify(candidatePr({ author: 'external-contributor' })).candidate, false)
})

for (const label of ['needs-human-qa', 'security', 'enterprise', 'backport', 'risk-high']) {
  test(`excluded label ${label} runs the normal suite`, () => {
    assert.equal(classify(candidatePr({ labels: ['feature', label] })).candidate, false)
  })
}

for (const file of ['packages/shared/src/lib/boolean.ts', 'packages/ui/src/primitives/button.tsx', '.github/workflows/ci.yml', 'packages/enterprise/src/modules/sso/index.ts']) {
  test(`touching ${file} runs the normal suite`, () => {
    assert.equal(classify(candidatePr({ changedFiles: [moduleFile, file] })).candidate, false)
  })
}

test('fork PR from a candidate author is not a candidate', () => {
  assert.equal(classify(candidatePr({ sameRepo: false })).candidate, false)
})

test('ci-full label always wins and forces the full suite', () => {
  const result = classify(candidatePr({ labels: ['ci-full'] }))
  assert.equal(result.candidate, false)
  assert.equal(result.forceFull, true)
})

test('ci-full on a fork does not force the full suite', () => {
  assert.equal(classify(candidatePr({ sameRepo: false, labels: ['ci-full'] })).forceFull, false)
})

test('FORCE_FULL_SUITE (stabilize/ and batch/ heads) always wins', () => {
  const result = classify(candidatePr({ forceFullSuite: true }))
  assert.equal(result.candidate, false)
  assert.equal(result.forceFull, true)
})

for (const baseRef of ['release/v0.9', 'feat/wms']) {
  test(`PR into ${baseRef} is not a candidate`, () => {
    assert.equal(classify(candidatePr({ baseRef })).candidate, false)
  })
}

test('push events are never candidates', () => {
  assert.equal(classify(candidatePr({ eventName: 'push' })).candidate, false)
})

test('switching to a dedicated label ignores the author list', () => {
  const labelConfig = { ...config, candidateLabel: 'batch-candidate' }
  assert.equal(classify(candidatePr({ config: labelConfig, author: 'anyone', labels: ['batch-candidate'] })).candidate, true)
  assert.equal(classify(candidatePr({ config: labelConfig, author: 'pkarw', labels: [] })).candidate, false)
})

for (const [scenario, change, expected] of [
  ['adding ci-full', { action: 'labeled', label: 'ci-full', labels: ['feature', 'ci-full'] }, true],
  ['adding risk-high', { action: 'labeled', label: 'risk-high', labels: ['feature', 'risk-high'] }, true],
  ['adding an unrelated label', { action: 'labeled', label: 'review', labels: ['feature', 'review'] }, false],
  ['removing an unrelated label', { action: 'unlabeled', label: 'review', labels: ['feature'] }, false],
  ['removing an excluded label (downgrade waits for a push)', { action: 'unlabeled', label: 'risk-high', labels: ['feature'] }, false],
  ['removing ci-full (downgrade waits for a push)', { action: 'unlabeled', label: 'ci-full', labels: ['feature'] }, false],
  ['adding ci-full to a second excluded label', { action: 'labeled', label: 'ci-full', labels: ['security', 'ci-full'] }, false],
]) {
  test(`label change: ${scenario} → rerun=${expected}`, () => {
    assert.equal(shouldRerunAfterLabelChange({ ...candidatePr(), ...change }).rerun, expected)
  })
}

test('label change on a non-candidate author never reruns', () => {
  const change = { action: 'labeled', label: 'ci-full', labels: ['ci-full'] }
  assert.equal(shouldRerunAfterLabelChange({ ...candidatePr({ author: 'external-contributor' }), ...change }).rerun, false)
})

test('removing the dedicated candidate label brings back the full suite', () => {
  const labelConfig = { ...config, candidateLabel: 'batch-candidate' }
  const result = shouldRerunAfterLabelChange({ ...candidatePr({ config: labelConfig }), action: 'unlabeled', label: 'batch-candidate', labels: ['feature'] })
  assert.equal(result.rerun, true)
})

function runCli(mode, env) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-candidate-'))
  try {
    const output = path.join(directory, 'output')
    const changed = path.join(directory, 'changed.txt')
    fs.writeFileSync(changed, `${(env.files ?? [moduleFile]).join('\n')}\n`)
    const result = spawnSync('node', [scriptPath, mode], {
      env: {
        PATH: process.env.PATH,
        GITHUB_OUTPUT: output,
        EVENT_NAME: 'pull_request',
        BASE_REF: 'main',
        PR_AUTHOR: 'pkarw',
        SAME_REPO: 'true',
        PR_LABELS: (env.labels ?? ['feature']).join('\n'),
        CHANGED_FILES_PATH: changed,
        FORCE_FULL_SUITE: 'false',
        ...env.extra,
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    return Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => line.split('=')))
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('CLI classify writes candidate and force_full outputs (pattern read from ci.yml)', () => {
  assert.deepEqual(runCli('classify', {}), { candidate: 'true', force_full: 'false' })
  assert.deepEqual(runCli('classify', { files: ['packages/shared/src/index.ts'] }), { candidate: 'false', force_full: 'false' })
  assert.deepEqual(runCli('classify', { labels: ['ci-full'] }), { candidate: 'false', force_full: 'true' })
  assert.deepEqual(runCli('classify', { extra: { SAME_REPO: 'false' } }), { candidate: 'false', force_full: 'false' })
  assert.deepEqual(runCli('classify', { extra: { PR_AUTHOR: 'someone-else' } }), { candidate: 'false', force_full: 'false' })
})

test('CLI label-change writes the rerun output', () => {
  assert.deepEqual(runCli('label-change', { labels: ['risk-high'], extra: { LABEL_ACTION: 'labeled', LABEL_NAME: 'risk-high' } }), { rerun: 'true' })
  assert.deepEqual(runCli('label-change', { labels: ['review'], extra: { LABEL_ACTION: 'labeled', LABEL_NAME: 'review' } }), { rerun: 'false' })
})

test('main rejects an unknown mode', () => {
  assert.throws(() => main(['nope'], { PR_LABELS: '', FULL_SUITE_PATTERN: fullSuitePattern }), /unknown mode/)
})

test('ci.yml still ignores label events; the relay workflow handles them', () => {
  assert.deepEqual(ciWorkflow.on.pull_request.types, ['opened', 'synchronize', 'reopened'])
  assert.deepEqual(rerunWorkflow.on.pull_request.types, ['labeled', 'unlabeled'])
  assert.deepEqual(rerunWorkflow.on.pull_request.branches, ['main'])
  const job = rerunWorkflow.jobs['rerun-full-suite']
  assert.equal(job.if, 'github.event.pull_request.head.repo.full_name == github.repository')
  assert.equal(job.permissions.actions, 'write')
  const rerunStep = job.steps.find((step) => step.run?.includes('gh run rerun'))
  assert.equal(rerunStep.if, "steps.decide.outputs.rerun == 'true'")
})

test('classify runs on every event and reads labels live', () => {
  const job = ciWorkflow.jobs.classify
  assert.equal(job.if, undefined)
  assert.equal(job.needs, undefined)
  assert.equal(job.permissions['pull-requests'], 'read')
  const step = job.steps.find((candidate) => candidate.id === 'classify')
  assert.match(step.run, /gh api "repos\/\$GITHUB_REPOSITORY\/pulls\/\$PR_NUMBER" --jq '\.labels\[\]\.name'/)
  assert.match(step.run, /node scripts\/ci\/batch-candidate\.mjs classify/)
})

test('candidates skip prepare, and every heavy job hangs off prepare', () => {
  assert.equal(ciWorkflow.jobs.prepare.needs, 'classify')
  assert.equal(ciWorkflow.jobs.prepare.if, "always() && !cancelled() && needs.classify.outputs.candidate != 'true'")
  for (const jobName of heavyJobs.slice(1)) {
    const needs = [ciWorkflow.jobs[jobName].needs].flat()
    assert.ok(needs.includes('prepare'), `${jobName} must need prepare`)
    const condition = ciWorkflow.jobs[jobName].if ?? ''
    assert.ok(!condition.includes("needs.prepare.result == 'skipped'"), `${jobName} must not run when prepare is skipped`)
    if (condition.includes('always()')) {
      assert.match(condition, /needs\.prepare\.result == 'success'/, `${jobName} must require a successful prepare`)
    }
  }
})

test('cheap required checks do not depend on the candidate decision', () => {
  for (const jobName of cheapJobs) {
    assert.ok(![ciWorkflow.jobs[jobName].needs].flat().includes('classify'), jobName)
    assert.ok(!(ciWorkflow.jobs[jobName].if ?? '').includes('classify'), jobName)
  }
})

test('candidates run the batch fast gate as a reusable workflow', () => {
  const job = ciWorkflow.jobs['batch-fast-gate']
  assert.equal(job.uses, './.github/workflows/batch-pr-ci.yml')
  assert.equal(job.needs, 'classify')
  assert.equal(job.if, "needs.classify.outputs.candidate == 'true'")
  assert.equal(job.secrets, 'inherit')
  assert.ok(Object.hasOwn(batchWorkflow.on, 'workflow_call'))
})

test('a ci-full label read live forces full scope in prepare and test', () => {
  const expression = "${{ needs.classify.outputs.force_full == 'true' || env.FORCE_FULL_SUITE == 'true' }}"
  const scope = ciWorkflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')
  assert.equal(scope.env.FORCE_FULL_SUITE, expression)
  assert.equal(ciWorkflow.jobs.prepare.outputs.force_full, expression)
  for (const stepName of ['Checking types', 'Test']) {
    const step = ciWorkflow.jobs.test.steps.find((candidate) => candidate.name === stepName)
    assert.equal(step.env.FORCE_FULL_SUITE, '${{ needs.prepare.outputs.force_full }}', stepName)
  }
})

test('batch doc points at the routing config and states the main-target rules', () => {
  assert.match(batchDoc, /\.github\/batch-candidates\.json/)
  assert.match(batchDoc, /cannot merge straight to\s+`main`/)
  assert.match(batchDoc, /next day.s batch branch/)
})
