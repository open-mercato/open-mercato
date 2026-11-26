import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

const readWorkflow = (name) => parse(fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
const ci = readWorkflow('ci.yml')
const mutation = readWorkflow('mutation-tests.yml')
const draftStep = ci.jobs['audit-scope'].steps.find((step) => step.id === 'draft')
const draftGate = "needs.audit-scope.outputs.draft != 'true'"

function detectDraft({ eventDraft, apiDraft, apiFails = false }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-draft-'))
  try {
    const output = path.join(directory, 'output')
    const summary = path.join(directory, 'summary')
    const calls = path.join(directory, 'calls')
    const fakeGh = `gh() { echo "$*" >> "${calls}"; ${apiFails ? 'return 1' : `echo ${apiDraft}`}; }\n`
    const result = spawnSync('bash', ['-e', '-c', `${fakeGh}${draftStep.run}`], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        GITHUB_STEP_SUMMARY: summary,
        EVENT_DRAFT: String(eventDraft),
        PR_NUMBER: '42',
        REPOSITORY: 'open-mercato/open-mercato',
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    return {
      draft: fs.readFileSync(output, 'utf8').trim(),
      apiCalled: fs.existsSync(calls),
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('ci.yml starts the suite when a draft PR is marked ready for review', () => {
  assert.ok(ci.on.pull_request.types.includes('ready_for_review'))
  for (const type of ['opened', 'synchronize', 'reopened']) {
    assert.ok(ci.on.pull_request.types.includes(type), `${type} must still trigger CI`)
  }
})

test('ci.yml keeps push validation of main and release lines', () => {
  assert.ok(ci.on.push.branches.includes('main'))
  assert.ok(ci.on.push.branches.includes('release/v*'))
})

test('audit-scope is the ungated draft gate, so a required check is always pending on a fresh run', () => {
  const job = ci.jobs['audit-scope']
  assert.equal(job.if, undefined)
  assert.equal(job.needs, undefined)
  assert.equal(job.outputs.draft, '${{ steps.draft.outputs.draft }}')
  assert.equal(job.steps[0].id, 'draft')
  assert.equal(job.permissions['pull-requests'], 'read')
  assert.equal(draftStep.env.EVENT_DRAFT, "${{ github.event_name == 'pull_request' && github.event.pull_request.draft == true }}")
})

test('every root job except audit-scope skips on a draft PR', () => {
  const rootJobs = Object.entries(ci.jobs).filter(([name, job]) => name !== 'audit-scope' && job.needs === undefined)
  assert.deepEqual(rootJobs.map(([name]) => name), [])
  for (const name of ['prepare', 'lint', 'ds-lint']) {
    assert.equal(ci.jobs[name].needs, 'audit-scope')
    assert.equal(ci.jobs[name].if, draftGate)
  }
})

test('push events and ready PRs are never treated as drafts and never call the API', () => {
  assert.deepEqual(detectDraft({ eventDraft: false, apiDraft: true }), { draft: 'draft=false', apiCalled: false })
})

test('a draft PR skips the suite', () => {
  assert.deepEqual(detectDraft({ eventDraft: true, apiDraft: true }), { draft: 'draft=true', apiCalled: true })
})

test('re-running a draft run after the PR was marked ready runs the suite', () => {
  assert.equal(detectDraft({ eventDraft: true, apiDraft: false }).draft, 'draft=false')
})

test('an API failure runs the suite rather than skipping it', () => {
  assert.equal(detectDraft({ eventDraft: true, apiFails: true }).draft, 'draft=false')
  assert.equal(detectDraft({ eventDraft: true, apiDraft: 'null' }).draft, 'draft=false')
})

test('mutation-tests.yml re-runs on ready_for_review and does no work on a draft PR', () => {
  const on = mutation.on ?? mutation[true]
  assert.deepEqual(on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'])
  const scope = mutation.jobs.scope
  assert.equal(scope.if, undefined, 'scope is a required check and must always report')
  for (const step of scope.steps.filter((step) => step.name !== 'Skip draft pull request')) {
    assert.equal(step.if, 'github.event.pull_request.draft != true', `${step.name} must skip on a draft PR`)
  }
  assert.equal(mutation.jobs.mutate.if, "needs.scope.outputs.has_work == 'true'")
})
