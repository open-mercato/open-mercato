import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const scope = workflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')
const repository = 'open-mercato/open-mercato'

function forcesFullSuite({ eventName = 'pull_request', branch, headRepository = repository, labels = [] }) {
  assert.equal(workflow.env.FORCE_FULL_SUITE, "${{ github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && (startsWith(github.head_ref, 'stabilize/') || contains(github.event.pull_request.labels.*.name, 'ci-full')) }}")
  return eventName === 'pull_request' && headRepository === repository && (branch.startsWith('stabilize/') || labels.includes('ci-full'))
}

function executeScript(script, { eventName = 'pull_request', fullSuite = false, changedPath = 'README.md', workflowChanged = false } = {}) {
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
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened'])
  for (const jobName of ['prepare', 'lint', 'ds-lint', 'audit-scope']) {
    assert.equal(workflow.jobs[jobName].if, undefined, `${jobName} must run for every scheduled event`)
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

for (const eventName of ['push', 'pull_request']) {
  test(`full validation selects all 15 shards on ${eventName} without consulting the diff`, () => {
    const { values } = executeScript(`git() { exit 99; }\n${scope.run}`, {
      eventName,
      fullSuite: forcesFullSuite({ eventName, branch: 'stabilize/main-2026-11-05' }),
    })
    assert.equal(values.skip, 'false')
    assert.equal(values.modules, '')
    assert.deepEqual(JSON.parse(values.shard_matrix), Array.from({ length: 15 }, (_, index) => `${index + 1}/15`))
  })
}

for (const [changedPath, expectedSkip, expectedModules] of [
  ['README.md', 'true', ''],
  ['packages/core/src/modules/customers/api/people.ts', 'false', 'customers'],
]) {
  test(`ordinary PR preserves integration scope for ${changedPath}`, () => {
    const { values } = executeScript(`git() { echo "$CHANGED_PATH"; }\n${scope.run}`, { changedPath })
    assert.equal(values.skip, expectedSkip)
    assert.equal(values.modules, expectedModules)
    assert.deepEqual(JSON.parse(values.shard_matrix), ['none'])
  })
}

test('ordinary shared-code changes still select all 15 integration shards', () => {
  const { values } = executeScript(`git() { echo "$CHANGED_PATH"; }\n${scope.run}`, {
    changedPath: 'packages/shared/src/lib/example.ts',
  })
  assert.equal(values.skip, 'false')
  assert.deepEqual(JSON.parse(values.shard_matrix), Array.from({ length: 15 }, (_, index) => `${index + 1}/15`))
})

for (const [stepName, command] of [['Checking types', 'typecheck'], ['Test', 'test']]) {
  for (const [scenario, options, expected] of [
    ['stabilization PR', { fullSuite: forcesFullSuite({ branch: 'stabilize/main-2026-11-05' }) }, command],
    ['ordinary PR', {}, `turbo run ${command} --filter=[origin/main]...`],
    ['workflow change', { workflowChanged: true }, command],
    ['protected branch push', { eventName: 'push' }, command],
  ]) {
    test(`${stepName} executes the correct command for ${scenario}`, () => {
      const step = workflow.jobs.test.steps.find((candidate) => candidate.name === stepName)
      const script = `git() { [ "$WORKFLOW_CHANGED" != "true" ]; }\nyarn() { echo "$*"; }\n${step.run}`
      assert.equal(executeScript(script, options).stdout, expected)
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

test('ci-full selects all shards for an ordinary documentation PR', () => {
  const { values } = executeScript(`git() { exit 99; }\n${scope.run}`, {
    fullSuite: forcesFullSuite({ branch: 'fix/docs', labels: ['ci-full'] }),
  })
  assert.equal(values.skip, 'false')
  assert.deepEqual(JSON.parse(values.shard_matrix), Array.from({ length: 15 }, (_, index) => `${index + 1}/15`))
})
