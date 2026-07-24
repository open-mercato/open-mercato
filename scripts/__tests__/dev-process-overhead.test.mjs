import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.resolve(here, '..', 'dev.mjs'), 'utf8')

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `expected ${name}() in scripts/dev.mjs`)
  const nextFunction = source.indexOf('\nfunction ', start + 1)
  return source.slice(start, nextFunction === -1 ? source.length : nextFunction)
}

test('consolidated package watch runs as a direct Node child while legacy watch stays on Yarn', () => {
  const body = functionBody('startPackageWatch')

  assert.match(body, /watchScript === 'watch:packages'/)
  assert.match(body, /command: process\.execPath, args: \[monorepoPackageWatchScript\]/)
  assert.match(body, /command: yarnCommand, args: \[watchScript\]/)
  assert.match(body, /spawnCommand\(watchCommand\.command, watchCommand\.args/)
})

test('monorepo app runtime runs its script directly from the app workspace', () => {
  const body = functionBody('launchMonorepoAppDev')

  assert.match(body, /const appArgs = \[monorepoAppDevScript\]/)
  assert.match(body, /spawnCommand\(process\.execPath, appArgs/)
  assert.match(body, /cwd: monorepoAppDir/)
  assert.doesNotMatch(body, /workspace.*@open-mercato\/app/)
})

test('direct monorepo app runtime retains access to workspace binaries', () => {
  const body = functionBody('buildAppDevEnv')

  assert.match(body, /node_modules', '\.bin'/)
  assert.match(body, /path\.delimiter/)
})
