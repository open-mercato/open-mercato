import assert from 'node:assert/strict'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { parse } from 'yaml'

const workflow = parse(fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8'))
const contributing = fs.readFileSync(new URL('../../CONTRIBUTING.md', import.meta.url), 'utf8')
const approvedHead = 'a'.repeat(40)

test('batch fix PRs get CI without adding stabilization branch push runs', () => {
  assert.deepEqual(workflow.on.pull_request.branches, ['main', 'release/v*', 'feat/wms', 'stabilize/**'])
  assert.deepEqual(workflow.on.push.branches, ['main', 'release/v*', 'feat/wms'])
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened', 'ready_for_review'])
})

function executeMergeBack(failingCommand = '') {
  const section = contributing.split('6. **Green tag and merge back.**')[1]
  assert.ok(section, 'The daily batch runbook must include merge-back commands')
  const match = section.match(/```bash\n([\s\S]*?)```/)
  assert.ok(match, 'The merge-back commands must be executable shell')
  const script = match[1]
    .replaceAll('<YYYY-MM-DD>', '2026-11-26')
    .replaceAll('<batch-head-sha>', approvedHead)
    .replaceAll('<batch-PR>', '123')
  const stubs = `
git() {
  printf 'git %s\\n' "$*"
  if [ "$1" = "$FAILING_COMMAND" ]; then return 1; fi
}
gh() { printf 'gh %s\\n' "$*"; }
`
  const result = spawnSync('bash', ['-c', stubs + script], {
    env: { ...process.env, FAILING_COMMAND: failingCommand },
    encoding: 'utf8',
    timeout: 5000,
  })
  assert.equal(result.error, undefined)
  return { status: result.status, commands: result.stdout.trim().split('\n') }
}

test('merge back publishes the immutable tag before merging the QA-approved head', () => {
  const result = executeMergeBack()
  assert.equal(result.status, 0)
  assert.deepEqual(result.commands, [
    'git fetch origin stabilize/qa-2026-11-26',
    `git tag green/2026-11-26 ${approvedHead}`,
    'git push origin green/2026-11-26',
    `gh pr merge 123 --squash --match-head-commit ${approvedHead}`,
  ])
})

for (const failingCommand of ['fetch', 'tag', 'push']) {
  test(`merge back stops when git ${failingCommand} fails`, () => {
    const result = executeMergeBack(failingCommand)
    assert.notEqual(result.status, 0)
    assert.ok(result.commands.every((command) => !command.startsWith('gh pr merge')))
    if (failingCommand === 'tag') {
      assert.ok(result.commands.every((command) => !command.startsWith('git push')))
    }
  })
}
