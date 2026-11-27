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

function detectDraft(step, { eventDraft, apiDraft, apiFails = false, stabilizationDraft = false }) {
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
        RUN_STABILIZATION_DRAFT: String(stabilizationDraft),
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

for (const [eventName, headRepository, branch, expected] of [
  ['pull_request', 'open-mercato/open-mercato', 'stabilize/main-2026-11-27', true],
  ['pull_request', 'contributor/fork', 'stabilize/main-2026-11-27', false],
  ['pull_request', 'open-mercato/open-mercato', 'fix/ordinary-pr', false],
  ['pull_request', 'open-mercato/open-mercato', 'fix/stabilize/main', false],
  ['push', 'open-mercato/open-mercato', 'stabilize/main-2026-11-27', false],
]) {
  test(`stabilization draft exception is ${expected} for ${eventName} ${headRepository}:${branch}`, () => {
    const expression = ciDraftStep.env.RUN_STABILIZATION_DRAFT.slice(3, -2).trim()
    const stabilizationDraft = vm.runInNewContext(expression, {
      github: {
        event_name: eventName,
        repository: 'open-mercato/open-mercato',
        head_ref: branch,
        event: { pull_request: { head: { repo: { full_name: headRepository } } } },
      },
      startsWith: (value, prefix) => value.startsWith(prefix),
    }, { timeout: 1000 })
    assert.equal(stabilizationDraft, expected)
    const result = detectDraft(ciDraftStep, { eventDraft: true, apiDraft: true, stabilizationDraft })
    assert.equal(result.draft, `draft=${!expected}`)
    assert.equal(result.apiCalled, !expected)
  })
}

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
  for (const step of ci.jobs.test.steps.slice(2)) {
    assert.doesNotMatch(String(step.if ?? ''), /\balways\(\)|\bfailure\(\)|cancelled\(\)/, `${step.name} must not run after a gate failed`)
  }
})

test('test still skips on a failed required dependency, which is itself red', () => {
  assert.equal(evaluateCondition(ci.jobs.test), true)
  assert.equal(evaluateCondition(ci.jobs.test, { results: { audit: 'skipped' } }), true)
  for (const dependency of ['prepare', 'audit-scope', 'lint']) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      assert.equal(evaluateCondition(ci.jobs.test, { results: { [dependency]: result } }), false, `${dependency} ${result}`)
    }
  }
})

const requiredCiChecks = ['prepare', 'lint', 'ds-lint', 'test', 'audit-scope', 'documents-multi-instance']
const auditGated = ['test', 'documents-multi-instance']

test('no required check can be skipped by a failed non-required dependency', () => {
  for (const name of requiredCiChecks) {
    const job = ci.jobs[name]
    for (const dependency of [job.needs ?? []].flat().filter((need) => !requiredCiChecks.includes(need))) {
      for (const result of ['failure', 'cancelled']) {
        assert.equal(evaluateCondition(job, { results: { [dependency]: result } }), true, `${name} must run (and fail) when ${dependency} is ${result}`)
      }
    }
  }
})

for (const name of auditGated) {
  test(`${name} fails at its first steps when audit failed or was cancelled`, () => {
    const gate = ci.jobs[name].steps.find((step) => step.name === 'Fail on failed audit')
    assert.ok(gate, `${name} needs an audit gate step`)
    assert.equal(gate.if, "needs.audit.result == 'failure' || needs.audit.result == 'cancelled'")
    assert.match(gate.run, /Audit failed/)
    assert.match(gate.run, /exit 1/)
    const gateIndex = ci.jobs[name].steps.indexOf(gate)
    assert.ok(gateIndex <= 1, 'the audit gate must come before any real work')
    for (const step of ci.jobs[name].steps.slice(gateIndex + 1)) {
      const condition = String(step.if ?? '')
      if (/cancelled\(\)|always\(\)/.test(condition)) {
        assert.match(condition, /steps\.audit-gate\.outcome != 'failure'/, `${step.name} must not run after the audit gate failed`)
      }
    }
  })

  test(`${name} keeps its normal path when audit succeeded or was not needed`, () => {
    for (const audit of ['success', 'skipped']) {
      assert.equal(evaluateCondition(ci.jobs[name], { results: { audit } }), true, `audit ${audit}`)
    }
  })
}

test('non-required suite jobs keep skipping on a failed audit', () => {
  for (const name of ['core-timezone', 'ephemeral-integration']) {
    for (const result of ['failure', 'cancelled']) {
      assert.equal(evaluateCondition(ci.jobs[name], { results: { audit: result } }), false, `${name} audit ${result}`)
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
  assert.equal(mutationDraftStep.run, ciDraftStep.run
    .replace(' && [ "${RUN_STABILIZATION_DRAFT}" != "true" ]', '')
    .replace('CI skipped. Mark it ready for review to run the checks.', 'mutation testing skipped. Mark it ready for review to run it.'))
  for (const step of scope.steps.slice(1)) {
    assert.equal(step.if, "steps.draft.outputs.draft != 'true'", `${step.name} must skip on a draft PR`)
  }
  assert.equal(mutation.jobs.mutate.if, "needs.scope.outputs.has_work == 'true'")
})


test('webhook durability steps preserve failure evidence without bypassing the audit gate', () => {
  for (const name of ['Install Redis durability test client', 'Run webhook receipt and queue durability against real services', 'Upload webhook durability results']) {
    const step = ci.jobs['documents-multi-instance'].steps.find((candidate) => candidate.name === name)
    assert.ok(step, name)
    const expression = step.if.replace(/^\$\{\{|\}\}$/g, '').replace(/steps\.audit-gate/g, 'steps["audit-gate"]')
    for (const outcome of ['success', 'skipped', 'failure']) {
      for (const isCancelled of [false, true]) {
        const actual = vm.runInNewContext(expression, {
          steps: { 'audit-gate': { outcome } },
          always: () => true,
          cancelled: () => isCancelled,
        }, { timeout: 1000 })
        const expected = outcome !== 'failure' && !isCancelled
        assert.equal(actual, expected, `${name}: audit ${outcome}, cancelled ${isCancelled}`)
      }
    }
  }
})
