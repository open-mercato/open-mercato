import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const scope = workflow.jobs.prepare.steps.find((step) => step.id === 'integration-scope')

for (const eventName of ['push', 'pull_request']) {
  test(`ci-full selects all 15 shards on ${eventName} without consulting the diff`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-full-'))
    try {
      const output = path.join(directory, 'output')
      const result = spawnSync('bash', ['-e', '-c', scope.run.replaceAll('${{ github.event_name }}', eventName)], {
        env: { ...process.env, GITHUB_OUTPUT: output, FORCE_FULL_SUITE: 'true' }, encoding: 'utf8', timeout: 5000,
      })
      assert.equal(result.status, 0, result.stderr)
      const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }))
      assert.equal(values.skip, 'false')
      assert.equal(values.modules, '')
      assert.deepEqual(JSON.parse(values.shard_matrix), Array.from({ length: 15 }, (_, index) => `${index + 1}/15`))
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}

test('label events trigger CI only for ci-full and read labels through an environment variable', () => {
  assert.ok(workflow.on.pull_request.types.includes('labeled'))
  assert.equal(workflow.jobs.prepare.if, "github.event.action != 'labeled' || github.event.label.name == 'ci-full'")
  assert.equal(scope.env.FORCE_FULL_SUITE, "${{ contains(github.event.pull_request.labels.*.name, 'ci-full') }}")
})

for (const [changedPath, expectedSkip, expectedModules] of [
  ['README.md', 'true', ''],
  ['packages/core/src/modules/customers/api/people.ts', 'false', 'customers'],
]) {
  test(`unlabelled PR preserves scope for ${changedPath}`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-scope-'))
    try {
      const output = path.join(directory, 'output')
      const script = `git() { echo "$CHANGED_PATH"; }\n${scope.run.replaceAll('${{ github.event_name }}', 'pull_request')}`
      const result = spawnSync('bash', ['-e', '-c', script], {
        env: { ...process.env, GITHUB_OUTPUT: output, FORCE_FULL_SUITE: 'false', CHANGED_PATH: changedPath },
        encoding: 'utf8', timeout: 5000,
      })
      assert.equal(result.status, 0, result.stderr)
      const content = fs.readFileSync(output, 'utf8')
      assert.ok(content.includes(`skip=${expectedSkip}\n`))
      assert.ok(content.includes(`modules=${expectedModules}\n`))
      assert.ok(content.includes('shard_matrix=["none"]'))
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
}
