import assert from 'node:assert/strict'
import fs from 'node:fs'
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
