import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const RELEASE_PREPARE_WORKFLOW = path.join(ROOT, '.github/workflows/release-prepare.yml')

function invokesHusky(script) {
  return typeof script === 'string' && /(^|&&|\|\||;|\s)husky(\s|$)/.test(script)
}

test('husky is initialized from a lifecycle script Yarn runs on install', () => {
  assert.ok(
    pkg.packageManager?.startsWith('yarn@'),
    'this guard assumes a Yarn-managed root; revisit it if the package manager changes'
  )
  assert.ok(
    invokesHusky(pkg.scripts?.postinstall),
    'root package.json scripts.postinstall must invoke husky: Yarn Berry does not run the root prepare script on install, so wiring husky only into prepare leaves a clean clone with no .husky/_ wrappers, no core.hooksPath, and no hooks running at all'
  )
})

test('release-prepare opts out of husky, because it commits in the job it installs in', () => {
  const workflow = readFileSync(RELEASE_PREPARE_WORKFLOW, 'utf8')

  const installs = /yarn install/.test(workflow)
  const commits = /git commit/.test(workflow)
  assert.ok(
    installs && commits,
    'this guard assumes release-prepare.yml still installs dependencies and then commits in the same job; revisit it if that changes'
  )

  // Ignore comment lines, so the inline rationale next to the opt-out cannot satisfy the guard on its own.
  const optsOut = workflow
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .some((line) => /^\s*HUSKY:\s*['"]?0['"]?\s*$/.test(line))

  assert.ok(
    optsOut,
    "release-prepare.yml must set HUSKY: '0' so its generated release commit does not run .husky/pre-commit. The root postinstall initializes husky wherever a .git directory exists, and actions/checkout provides one, so without the opt-out the hook's i18n and template --fix output would be staged into the machine-made chore: release commit"
  )
})
