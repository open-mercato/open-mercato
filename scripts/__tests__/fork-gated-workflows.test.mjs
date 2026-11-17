import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'

const forkGate = '${{ !github.event.repository.fork }}'

function readWorkflow(name) {
  return parse(fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
}

test('the npm snapshot publish job is skipped in forks', () => {
  const workflow = readWorkflow('snapshot.yml')
  assert.equal(workflow.jobs.snapshot.if, forkGate)
})

test('every snapshot job depends on the fork-gated publish job', () => {
  const workflow = readWorkflow('snapshot.yml')
  for (const [jobId, job] of Object.entries(workflow.jobs)) {
    if (jobId === 'snapshot') continue
    const needs = [job.needs].flat()
    assert.ok(needs.includes('snapshot'), `${jobId} must need the fork-gated snapshot job`)
    assert.doesNotMatch(String(job.if ?? ''), /always\(\)/, `${jobId} must not run when snapshot is skipped`)
  }
})

test('the enterprise contribution guard is skipped in forks without keying on the repository name', () => {
  const workflow = readWorkflow('enterprise-contribution-guard.yml')
  assert.equal(workflow.jobs.guard.if, forkGate)
  assert.doesNotMatch(workflow.jobs.guard.if, /github\.repository\b/)
})
