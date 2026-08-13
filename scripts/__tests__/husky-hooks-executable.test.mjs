import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const EXECUTABLE_MODE = '100755'

// Mirrors the hook list husky@9 installs wrappers for (node_modules/husky/index.js).
// Anything else under .husky/ — a sourced common.sh, a README — is never invoked by
// git and must stay outside this assertion.
const GIT_HOOK_NAMES = new Set([
  'applypatch-msg',
  'commit-msg',
  'post-applypatch',
  'post-checkout',
  'post-commit',
  'post-merge',
  'post-rewrite',
  'pre-applypatch',
  'pre-auto-gc',
  'pre-commit',
  'pre-merge-commit',
  'pre-push',
  'pre-rebase',
  'prepare-commit-msg',
])

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
}

function listTrackedHuskyHooks() {
  return git(['ls-files', '--stage', '-z', '--', '.husky'])
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const [meta, relPath] = entry.split('\t')
      const [mode] = meta.split(' ')
      return { mode, relPath }
    })
    .filter(({ relPath }) => !relPath.startsWith('.husky/_/'))
    .filter(({ relPath }) => GIT_HOOK_NAMES.has(path.basename(relPath)))
}

test('every tracked .husky/ git hook is committed with the executable git mode', () => {
  const hooks = listTrackedHuskyHooks()
  assert.ok(hooks.length > 0, 'expected at least one tracked git hook under .husky/ to validate against')
  for (const { mode, relPath } of hooks) {
    assert.equal(
      mode,
      EXECUTABLE_MODE,
      `${relPath} is tracked with mode ${mode}, not ${EXECUTABLE_MODE}. Hooks under .husky/ are kept executable so they run under any hooks-path layout, including a checkout whose core.hooksPath points at .husky itself instead of husky's .husky/_ wrapper directory`
    )
  }
})
