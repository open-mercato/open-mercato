import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXECUTABLE_MODE = '100755'

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function listTrackedHuskyHooks() {
  return git(['ls-files', '--stage', '--', '.husky'])
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [mode, , , relPath] = line.split(/\s+/)
      return { mode, relPath }
    })
    .filter(({ relPath }) => !relPath.startsWith('.husky/_/'))
}

test('every tracked .husky/ hook is committed with the executable git mode', () => {
  const hooks = listTrackedHuskyHooks()
  assert.ok(hooks.length > 0, 'expected at least one tracked file under .husky/ to validate against')
  for (const { mode, relPath } of hooks) {
    assert.equal(
      mode,
      EXECUTABLE_MODE,
      `${relPath} is tracked with mode ${mode}, not ${EXECUTABLE_MODE} — with core.hooksPath=.husky and no .husky/_/ wrapper, git silently skips a non-executable hook on every commit`
    )
  }
})
