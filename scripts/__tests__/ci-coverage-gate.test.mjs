import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(path.resolve('.github/workflows/ci.yml'), 'utf8'))
const coverageJob = workflow.jobs['merge-coverage']
const prerequisites = ['prepare', 'test', 'documents-multi-instance', 'ephemeral-integration']

function shouldRunCoverage({ results = {}, cancelled = false, shardMatrix = '["1/15"]', audit = 'skipped' } = {}) {
  const needs = Object.fromEntries(prerequisites.map((job) => [job, { result: results[job] ?? 'success' }]))
  needs.prepare.outputs = { shard_matrix: shardMatrix }
  const condition = coverageJob.if.trim()
  const hasStatusFunction = /\b(?:always|cancelled|failure|success)\s*\(/.test(condition)
  const success = () => !cancelled && audit === 'success' && Object.values(needs).every((job) => job.result === 'success')

  return (hasStatusFunction || success()) && vm.runInNewContext(condition, {
    needs,
    cancelled: () => cancelled,
    always: () => true,
    success,
    failure: () => Object.values(needs).some((job) => job.result === 'failure'),
  })
}

test('coverage aggregation waits for the build and every required test job', () => {
  assert.deepEqual(coverageJob.needs, prerequisites)
})

test('coverage aggregation runs after successful tests when the dependency audit is out of scope', () => {
  assert.equal(shouldRunCoverage(), true)
  assert.equal(shouldRunCoverage({ audit: 'success' }), true)
})

test('coverage aggregation requires every direct prerequisite to succeed', () => {
  for (const job of prerequisites) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(shouldRunCoverage({ results: { [job]: result } }), false, `${job}: ${result}`)
    }
  }
})

test('coverage aggregation skips cancelled runs and runs without shard artifacts', () => {
  assert.equal(shouldRunCoverage({ cancelled: true }), false)
  assert.equal(shouldRunCoverage({ shardMatrix: '["none"]' }), false)
})

test('downloaded shard reports reach the configured coverage merge command', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-coverage-artifacts-'))
  const download = coverageJob.steps.find((step) => step.name === 'Download shard artifacts')
  const merge = coverageJob.steps.find((step) => step.name === 'Merge shard coverage reports')
  const reportRoot = path.resolve(workspace, download.with.path ?? '.')
  const metric = { total: 1, covered: 1, skipped: 0, pct: 100 }
  const metrics = Object.fromEntries(['lines', 'statements', 'functions', 'branches'].map((name) => [name, metric]))

  try {
    for (let index = 1; index <= 15; index += 1) {
      const shardRoot = path.join(reportRoot, `coverage-shard-${index}`, 'code')
      fs.mkdirSync(shardRoot, { recursive: true })
      fs.writeFileSync(path.join(shardRoot, 'coverage-summary.json'), JSON.stringify({
        total: metrics,
        [`source-${index}.ts`]: metrics,
      }))
    }

    const [runtime, script, ...args] = merge.run.trim().split(/\s+/)
    assert.equal(runtime, 'node')
    const merged = spawnSync(process.execPath, [path.resolve(script), ...args], { cwd: workspace, encoding: 'utf8' })
    assert.equal(merged.status, 0, merged.stderr)
    assert.match(merged.stdout, /Merged 15 shards/)
    const summary = JSON.parse(fs.readFileSync(path.join(workspace, args[0], 'coverage/code/coverage-summary.json'), 'utf8'))
    assert.equal(summary.total.lines.total, 15)
    assert.equal(summary.total.lines.covered, 15)
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true })
  }
})
