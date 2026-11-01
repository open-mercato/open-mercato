import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const coverageJob = workflow.jobs['merge-coverage']

function evaluateCoverageCondition(overrides = {}, shardMatrix = '["1/15","2/15"]') {
  const needs = Object.fromEntries(coverageJob.needs.map((dependency) => [dependency, { result: 'success' }]))
  for (const [dependency, result] of Object.entries(overrides)) needs[dependency] = { result }
  needs.prepare.outputs = { shard_matrix: shardMatrix }
  const expression = coverageJob.if.replace(/needs\.([\w-]+)/g, 'needs["$1"]')
  return vm.runInNewContext(expression, { needs, always: () => true }, { timeout: 1000 })
}

test('coverage aggregation explicitly overrides skipped-ancestor propagation', () => {
  assert.match(coverageJob.if, /\balways\(\)/)
  assert.equal(evaluateCoverageCondition({ audit: 'skipped' }), true)
})

test('coverage aggregation requires every direct dependency to succeed', () => {
  for (const dependency of coverageJob.needs) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(evaluateCoverageCondition({ [dependency]: result }), false, `${dependency}: ${result}`)
    }
  }
})

test('coverage aggregation skips unsharded integration runs', () => {
  assert.equal(evaluateCoverageCondition({}, '["none"]'), false)
})
