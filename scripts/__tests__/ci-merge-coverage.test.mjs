import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const coverageJob = workflow.jobs['merge-coverage']

function evaluateJobCondition(job, overrides = {}, { workflowCancelled = false, shardMatrix = '["1/15","2/15"]' } = {}) {
  const needs = Object.fromEntries(job.needs.map((dependency) => [dependency, { result: 'success' }]))
  for (const [dependency, result] of Object.entries(overrides)) needs[dependency] = { result }
  needs.prepare.outputs = { shard_matrix: shardMatrix, skip_integration: 'false' }
  const expression = job.if.replace(/needs\.([\w-]+)/g, 'needs["$1"]')
  return vm.runInNewContext(expression, {
    needs,
    always: () => true,
    cancelled: () => workflowCancelled,
  }, { timeout: 1000 })
}

test('coverage aggregation explicitly overrides skipped-ancestor propagation', () => {
  assert.match(coverageJob.if, /\balways\(\)/)
  assert.equal(evaluateJobCondition(coverageJob, { audit: 'skipped' }), true)
})

test('coverage aggregation requires every direct dependency to succeed', () => {
  for (const dependency of coverageJob.needs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(evaluateJobCondition(coverageJob, { [dependency]: result }), false, `${dependency}: ${result}`)
    }
  }
})

test('coverage aggregation skips unsharded integration runs', () => {
  assert.equal(evaluateJobCondition(coverageJob, {}, { shardMatrix: '["none"]' }), false)
})

const cancellableJobNames = ['test', 'core-timezone', 'documents-multi-instance', 'ephemeral-integration', 'merge-coverage']

test('ordinary CI jobs remain eligible when audit is skipped', () => {
  for (const jobName of cancellableJobNames) {
    assert.equal(evaluateJobCondition(workflow.jobs[jobName], { audit: 'skipped' }), true, jobName)
  }
})

test('ordinary CI jobs stop when the workflow is cancelled even after successful dependencies', () => {
  for (const jobName of cancellableJobNames) {
    assert.equal(evaluateJobCondition(workflow.jobs[jobName], {}, { workflowCancelled: true }), false, jobName)
  }
})

test('ordinary CI jobs reject unsuccessful dependencies except an intentionally skipped audit', () => {
  for (const jobName of cancellableJobNames) {
    const job = workflow.jobs[jobName]
    for (const dependency of job.needs) {
      for (const result of ['failure', 'cancelled', 'skipped']) {
        assert.equal(
          evaluateJobCondition(job, { [dependency]: result }),
          dependency === 'audit' && result === 'skipped',
          `${jobName}: ${dependency} ${result}`,
        )
      }
    }
  }
})

test('CI orchestration changes select the full integration suite without including docs-only changes', () => {
  const scopeStep = workflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')
  const patternAssignment = scopeStep.run.match(/^\s*FULL_SUITE_PATTERN='([^']+)'$/m)
  assert.ok(patternAssignment)
  const fullSuitePattern = new RegExp(patternAssignment[1])

  assert.match('.github/workflows/ci.yml', fullSuitePattern)
  for (const excludedPath of ['README.md', 'apps/docs/docs/index.mdx', '.github/workflows/community-labels.yml']) {
    assert.doesNotMatch(excludedPath, fullSuitePattern)
  }
})

function runValidationSteps({ eventName = 'pull_request', changedPath = 'README.md', createParent = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-validation-scope-'))
  try {
    const git = (...argumentsList) => {
      const result = spawnSync('git', ['-c', 'user.name=CI Test', '-c', 'user.email=ci-test@example.invalid', ...argumentsList], {
        cwd: root,
        encoding: 'utf8',
        timeout: 10000,
      })
      assert.equal(result.status, 0, result.stderr)
    }
    git('init', '--quiet')
    fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true })
    fs.writeFileSync(path.join(root, '.github/workflows/ci.yml'), 'baseline\n')
    git('add', '.')
    git('commit', '--quiet', '-m', 'initial fixture')
    if (createParent) {
      const changedFile = path.join(root, changedPath)
      fs.mkdirSync(path.dirname(changedFile), { recursive: true })
      fs.writeFileSync(changedFile, 'changed\n')
      git('add', '.')
      git('commit', '--quiet', '-m', 'changed fixture')
    }
    const binDir = path.join(root, 'bin')
    const callsFile = path.join(root, 'yarn-calls')
    fs.mkdirSync(binDir)
    fs.writeFileSync(path.join(binDir, 'yarn'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$YARN_CALLS_FILE"\n', { mode: 0o755 })
    for (const stepName of ['Checking types', 'Test']) {
      const step = workflow.jobs.test.steps.find((candidate) => candidate.name === stepName)
      const script = step.run
        .replaceAll('${{ github.event_name }}', eventName)
        .replaceAll('${{ github.base_ref }}', 'main')
      const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: `${binDir}${path.delimiter}${process.env.PATH}`, YARN_CALLS_FILE: callsFile },
        timeout: 10000,
      })
      assert.equal(result.status, 0, `${stepName}: ${result.stderr}`)
    }
    return fs.readFileSync(callsFile, 'utf8').trim().split('\n')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
}

test('CI workflow edits run full typecheck and unit gates', () => {
  assert.deepEqual(runValidationSteps({ changedPath: '.github/workflows/ci.yml' }), ['typecheck', 'test'])
})

test('documentation and module PRs preserve affected-package validation', () => {
  for (const changedPath of ['README.md', 'packages/core/src/modules/customers/index.ts']) {
    assert.deepEqual(runValidationSteps({ changedPath }), [
      'turbo run typecheck --filter=[origin/main]...',
      'turbo run test --filter=[origin/main]...',
    ])
  }
})

test('protected branch pushes run full typecheck and unit gates', () => {
  assert.deepEqual(runValidationSteps({ eventName: 'push' }), ['typecheck', 'test'])
})

test('unavailable PR comparison ancestry falls back to full validation', () => {
  assert.deepEqual(runValidationSteps({ createParent: false }), ['typecheck', 'test'])
})
