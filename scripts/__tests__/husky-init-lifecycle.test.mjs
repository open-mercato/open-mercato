import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const RELEASE_WORKFLOWS = ['release.yml', 'release-publish.yml'].map((name) => path.join(ROOT, '.github/workflows', name))

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

test('release workflows opt out of husky and never commit in the job they install in', () => {
  for (const file of RELEASE_WORKFLOWS) {
    const workflow = readFileSync(file, 'utf8')
    const name = path.basename(file)

    assert.match(workflow, /yarn install/, `this guard assumes ${name} installs dependencies; revisit it if that changes`)
    assert.doesNotMatch(
      workflow,
      /git commit/,
      `${name} must not commit locally: release commits go through the GitHub API (scripts/release-line.mts), so no hook can stage --fix output into them`,
    )

    // Ignore comment lines, so an inline rationale next to the opt-out cannot satisfy the guard on its own.
    const optsOut = workflow
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .some((line) => /^\s*HUSKY:\s*['"]?0['"]?\s*$/.test(line))

    assert.ok(
      optsOut,
      `${name} must set HUSKY: '0': the root postinstall initializes husky wherever a .git directory exists, and actions/checkout provides one`,
    )
  }
})
