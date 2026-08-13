import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

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
