import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

const forkGate = '${{ !github.event.repository.fork }}'
const statusOverride = /\b(?:always|cancelled|failure)\s*\(\)|!\s*success\s*\(\)/

function readWorkflow(name) {
  return parse(fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
}

test('the npm snapshot publish job is skipped in forks', () => {
  const workflow = readWorkflow('snapshot.yml')
  assert.equal(workflow.jobs.snapshot.if, forkGate)
})

test('every other snapshot job keeps the default success dependency on the fork-gated publish job', () => {
  const workflow = readWorkflow('snapshot.yml')
  const downstream = Object.entries(workflow.jobs).filter(([jobId]) => jobId !== 'snapshot')
  assert.deepEqual(
    Object.fromEntries(downstream.map(([jobId, job]) => [jobId, job.if])),
    { 'standalone-integration': "needs.snapshot.outputs.snapshot_version != ''" },
    'a new or changed snapshot job needs explicit fork-gate coverage in this test',
  )
  for (const [jobId, job] of downstream) {
    const needs = [job.needs].flat()
    assert.ok(needs.includes('snapshot'), `${jobId} must need the fork-gated snapshot job`)
    assert.doesNotMatch(String(job.if ?? ''), statusOverride, `${jobId} must not run when snapshot is skipped`)
  }
})

test('the enterprise contribution guard is skipped in forks without keying on the repository name', () => {
  const workflow = readWorkflow('enterprise-contribution-guard.yml')
  assert.equal(workflow.jobs.guard.if, forkGate)
})
