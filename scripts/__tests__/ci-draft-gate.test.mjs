import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import vm from 'node:vm'
import { parse } from 'yaml'

const readWorkflow = (name) => parse(fs.readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8'))
const ci = readWorkflow('ci.yml')
const mutation = readWorkflow('mutation-tests.yml')
const ciDraftStep = ci.jobs['audit-scope'].steps.find((step) => step.id === 'draft')
const mutationDraftStep = mutation.jobs.scope.steps.find((step) => step.id === 'draft')
const draftGate = "needs.audit-scope.outputs.draft != 'true'"
const liveEventDraft = "${{ github.event_name == 'pull_request' && github.event.pull_request.draft == true }}"

function detectDraft(step, { eventDraft, apiDraft, apiFails = false }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-draft-'))
  try {
    const output = path.join(directory, 'output')
    const summary = path.join(directory, 'summary')
    const calls = path.join(directory, 'calls')
    const fakeGh = `gh() { echo "$*" >> "${calls}"; ${apiFails ? 'return 1' : `echo ${apiDraft}`}; }\n`
    const result = spawnSync('bash', ['-e', '-c', `${fakeGh}${step.run}`], {
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

function evaluateCondition(job, { draft = 'false', results = {} } = {}) {
  const needs = Object.fromEntries([job.needs].flat().map((dependency) => [dependency, { result: 'success', outputs: {} }]))
  for (const [dependency, result] of Object.entries(results)) needs[dependency] = { ...needs[dependency], result }
  needs['audit-scope'].outputs = { draft }
  needs.prepare.outputs = { skip_integration: 'false', shard_matrix: '["1/15"]' }
  const expression = job.if.replace(/needs\.([\w-]+)/g, 'needs["$1"]')
  return vm.runInNewContext(expression, { needs, always: () => true, cancelled: () => false }, { timeout: 1000 })
}

const draftRunResults = { prepare: 'skipped', lint: 'skipped', audit: 'skipped' }

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

test('audit-scope is the ungated draft detector and reads the draft state live', () => {
  const job = ci.jobs['audit-scope']
  assert.equal(job.if, undefined)
  assert.equal(job.needs, undefined)
  assert.equal(job.outputs.draft, '${{ steps.draft.outputs.draft }}')
  assert.equal(job.steps[0].id, 'draft')
  assert.equal(job.permissions['pull-requests'], 'read')
  assert.equal(ciDraftStep.env.EVENT_DRAFT, liveEventDraft)
})

test('every root job except audit-scope skips on a draft PR', () => {
  const rootJobs = Object.entries(ci.jobs).filter(([name, job]) => name !== 'audit-scope' && job.needs === undefined)
  assert.deepEqual(rootJobs.map(([name]) => name), [])
  for (const name of ['prepare', 'lint', 'ds-lint']) {
    assert.equal(ci.jobs[name].needs, 'audit-scope')
    assert.equal(ci.jobs[name].if, draftGate)
  }
})

test('the required test job FAILS on a draft PR instead of skipping', () => {
  assert.equal(evaluateCondition(ci.jobs.test, { draft: 'true', results: draftRunResults }), true)
  const [gate] = ci.jobs.test.steps
  assert.equal(gate.name, 'Fail on draft pull request')
  assert.equal(gate.if, "needs.audit-scope.outputs.draft == 'true'")
  assert.match(gate.run, /exit 1/)
  for (const step of ci.jobs.test.steps.slice(1)) {
    assert.doesNotMatch(String(step.if ?? ''), /\balways\(\)|\bfailure\(\)/, `${step.name} must not run after the draft gate failed`)
  }
})

test('the draft failure path is the only change to when test runs on a ready PR', () => {
  assert.equal(evaluateCondition(ci.jobs.test), true)
  assert.equal(evaluateCondition(ci.jobs.test, { results: { audit: 'skipped' } }), true)
  for (const dependency of ['prepare', 'audit-scope', 'lint', 'audit']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      if (dependency === 'audit' && result === 'skipped') continue
      assert.equal(evaluateCondition(ci.jobs.test, { results: { [dependency]: result } }), false, `${dependency} ${result}`)
    }
  }
})

test('suite jobs keep requiring a successful prepare and never run on a draft', () => {
  for (const name of ['test', 'documents-multi-instance', 'ephemeral-integration', 'core-timezone']) {
    const condition = ci.jobs[name].if
    assert.match(condition, /^always\(\) &&/, name)
    assert.match(condition, /needs\.prepare\.result == 'success'/, name)
  }
  for (const name of ['documents-multi-instance', 'ephemeral-integration', 'core-timezone']) {
    assert.equal(evaluateCondition(ci.jobs[name], { draft: 'true', results: draftRunResults }), false, name)
    assert.doesNotMatch(ci.jobs[name].if, /outputs\.draft/, `${name} must skip, not run, on a draft`)
  }
})

for (const [label, step] of [['ci.yml', () => ciDraftStep], ['mutation-tests.yml', () => mutationDraftStep]]) {
  test(`${label}: push events and ready PRs are never drafts and never call the API`, () => {
    assert.deepEqual(detectDraft(step(), { eventDraft: false, apiDraft: true }), { draft: 'draft=false', apiCalled: false })
  })

  test(`${label}: a draft PR is detected`, () => {
    assert.deepEqual(detectDraft(step(), { eventDraft: true, apiDraft: true }), { draft: 'draft=true', apiCalled: true })
  })

  test(`${label}: re-running a draft run after the PR was marked ready is not a draft`, () => {
    assert.equal(detectDraft(step(), { eventDraft: true, apiDraft: false }).draft, 'draft=false')
  })

  test(`${label}: an API failure runs the work rather than skipping it`, () => {
    assert.equal(detectDraft(step(), { eventDraft: true, apiFails: true }).draft, 'draft=false')
    assert.equal(detectDraft(step(), { eventDraft: true, apiDraft: 'null' }).draft, 'draft=false')
  })
}

test('mutation-tests.yml re-runs on ready_for_review and does no work on a live draft', () => {
  const on = mutation.on ?? mutation[true]
  assert.deepEqual(on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'])
  const scope = mutation.jobs.scope
  assert.equal(scope.if, undefined, 'scope is a required check and must always report')
  assert.equal(scope.permissions['pull-requests'], 'read')
  assert.equal(scope.steps[0].id, 'draft')
  assert.equal(mutationDraftStep.env.EVENT_DRAFT, liveEventDraft)
  assert.equal(mutationDraftStep.run, ciDraftStep.run.replace('CI skipped. Mark it ready for review to run the checks.', 'mutation testing skipped. Mark it ready for review to run it.'))
  for (const step of scope.steps.slice(1)) {
    assert.equal(step.if, "steps.draft.outputs.draft != 'true'", `${step.name} must skip on a draft PR`)
  }
  assert.equal(mutation.jobs.mutate.if, "needs.scope.outputs.has_work == 'true'")
})
