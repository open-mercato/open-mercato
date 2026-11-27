import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'
import { FULL_SHARDS, runCiScopeStep } from './fixtures/ci-scope-step.mjs'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const scope = workflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')
const repository = 'open-mercato/open-mercato'

function forcesFullSuite({ eventName = 'pull_request', branch, headRepository = repository, labels = [] }) {
  assert.equal(workflow.env.FORCE_FULL_SUITE, "${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && (startsWith(github.head_ref, 'stabilize/') || contains(github.event.pull_request.labels.*.name, 'ci-full')) }}")
  return eventName === 'pull_request' && headRepository === repository && (branch.startsWith('stabilize/') || labels.includes('ci-full'))
}

function executeScript(script, { eventName = 'pull_request', fullSuite = false, changedPath = 'README.md', workflowChanged = false, baseMissing = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'))
  try {
    const output = path.join(directory, 'output')
    const prepared = script
      .replaceAll('${{ github.event_name }}', eventName)
      .replaceAll('${{ github.base_ref }}', 'main')
    const result = spawnSync('bash', ['-e', '-c', prepared], {
      env: {
        ...process.env,
        GITHUB_OUTPUT: output,
        FORCE_FULL_SUITE: String(fullSuite),
        CHANGED_PATH: changedPath,
        WORKFLOW_CHANGED: String(workflowChanged),
        BASE_MISSING: String(baseMissing),
      },
      encoding: 'utf8',
      timeout: 5000,
    })
    assert.equal(result.status, 0, result.stderr)
    const values = fs.existsSync(output)
      ? Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }))
      : {}
    return { values, stdout: result.stdout.trim() }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

test('PR label changes cannot schedule CI or publish new skipped required checks', () => {
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'])
  assert.equal(workflow.jobs['audit-scope'].if, undefined, 'audit-scope must run for every scheduled event')
  for (const jobName of ['prepare', 'lint', 'ds-lint']) {
    assert.equal(workflow.jobs[jobName].if, "needs.audit-scope.outputs.draft != 'true'", `${jobName} may skip only for a draft PR`)
  }
  assert.equal(scope.env?.FORCE_FULL_SUITE, undefined)
  assert.ok(!workflow.on.pull_request.types.includes('labeled'))
})

for (const [branch, headRepository, expected] of [
  ['stabilize/main-2026-11-05', repository, true],
  ['stabilize/release-v0.9', repository, true],
  ['fix/ordinary-pr', repository, false],
  ['fix/stabilize-main', repository, false],
  ['feature/stabilize/main', repository, false],
  ['stabilize/main-2026-11-05', 'contributor/fork', false],
]) {
  test(`stabilization full scope is ${expected} for ${headRepository}:${branch}`, () => {
    assert.equal(forcesFullSuite({ branch, headRepository }), expected)
  })
}

test('full validation selects all 15 shards on push without consulting the diff', () => {
  const { status, stderr, values, calls } = runCiScopeStep({ eventName: 'push' })
  assert.equal(status, 0, stderr)
  assert.deepEqual(calls, [])
  assert.equal(values.skip, 'false')
  assert.equal(values.modules, '')
  assert.deepEqual(JSON.parse(values.shard_matrix), FULL_SHARDS)
})

for (const [headRef, headRepo, expectedFull] of [
  ['stabilize/main-2026-11-05', repository, true],
  ['stabilize/main-2026-11-05', 'contributor/fork', false],
  ['fix/stabilize-main', repository, false],
]) {
  test(`stabilization scope selects full=${expectedFull} for ${headRepo}:${headRef}`, () => {
    const { status, stderr, values } = runCiScopeStep({ headRef, headRepo, changedFiles: ['README.md'] })
    assert.equal(status, 0, stderr)
    assert.equal(values.skip, String(!expectedFull))
    assert.deepEqual(JSON.parse(values.shard_matrix), expectedFull ? FULL_SHARDS : ['none'])
  })
}

for (const [changedPath, expectedSkip, expectedModules] of [
  ['README.md', 'true', ''],
  ['packages/core/src/modules/customers/api/people.ts', 'false', 'customers'],
]) {
  test(`ordinary PR preserves integration scope for ${changedPath}`, () => {
    const { status, stderr, values } = runCiScopeStep({ changedFiles: [changedPath] })
    assert.equal(status, 0, stderr)
    assert.equal(values.skip, expectedSkip)
    assert.equal(values.modules, expectedModules)
    assert.deepEqual(JSON.parse(values.shard_matrix), ['none'])
  })
}

test('ordinary shared-code changes still select all 15 integration shards', () => {
  const { status, stderr, values } = runCiScopeStep({ changedFiles: ['packages/shared/src/lib/example.ts'] })
  assert.equal(status, 0, stderr)
  assert.equal(values.skip, 'false')
  assert.deepEqual(JSON.parse(values.shard_matrix), FULL_SHARDS)
})

for (const [stepName, command] of [['Checking types', 'typecheck'], ['Test', 'test']]) {
  for (const [scenario, options, expected, warns = false] of [
    ['stabilization PR', { fullSuite: forcesFullSuite({ branch: 'stabilize/main-2026-11-05' }) }, command],
    ['ordinary PR', {}, `turbo run ${command} --filter=[HEAD^1]...`],
    ['workflow change', { workflowChanged: true }, command],
    ['missing PR base commit', { baseMissing: true }, command, true],
    ['protected branch push', { eventName: 'push' }, command],
  ]) {
    test(`${stepName} executes the correct command for ${scenario}`, () => {
      const step = workflow.jobs.test.steps.find((candidate) => candidate.name === stepName)
      const gitStub = 'git() { if [ "$1" = rev-parse ]; then [ "$BASE_MISSING" != "true" ]; else [ "$WORKFLOW_CHANGED" != "true" ]; fi; }'
      const script = `${gitStub}\nyarn() { echo "$*"; }\n${step.run}`
      const lines = executeScript(script, options).stdout.split('\n')
      assert.equal(lines.at(-1), expected)
      assert.equal(lines.length > 1 && lines[0].startsWith('::warning::'), warns)
    })
  }
}

for (const [eventName, headRepository, labels, expected] of [
  ['pull_request', repository, ['ci-full'], true],
  ['pull_request', repository, ['bug'], false],
  ['pull_request', 'contributor/fork', ['ci-full'], false],
  ['push', repository, ['ci-full'], false],
]) {
  test(`ci-full scope is ${expected} for ${eventName} from ${headRepository} with ${labels}`, () => {
    assert.equal(forcesFullSuite({ eventName, headRepository, labels, branch: 'fix/ordinary-pr' }), expected)
  })
}

for (const [headRepo, expectedFull] of [[repository, true], ['contributor/fork', false]]) {
  test(`ci-full read from the API selects full=${expectedFull} for a documentation PR from ${headRepo}`, () => {
    const { status, stderr, values } = runCiScopeStep({ headRef: 'fix/docs', headRepo, labels: ['ci-full'], changedFiles: ['README.md'] })
    assert.equal(status, 0, stderr)
    assert.equal(values.skip, String(!expectedFull))
    assert.deepEqual(JSON.parse(values.shard_matrix), expectedFull ? FULL_SHARDS : ['none'])
  })
}
