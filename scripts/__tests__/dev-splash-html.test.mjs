import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const here = import.meta.dirname
const root = path.resolve(here, '..', '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('dev splash html stays synced with create-app template copy', () => {
  assert.equal(
    read('scripts/dev-splash.html'),
    read('packages/create-app/template/scripts/dev-splash.html'),
  )
})

test('dev splash keeps stabilized stream layout and explicit locale picker', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /\.stream-shell\s*{[^}]*height:\s*100%;/s)
  assert.match(source, /\.hero-body\s*{[^}]*align-content:\s*start;/s)
  assert.match(source, /if \(overflowing\) {\s*activityList\.scrollTop = activityList\.scrollHeight\s*}/s)
  assert.match(source, /<select class="locale-select" id="locale-select" aria-label="Language"><\/select>/)
})

test('dev splash recognizes greenfield, setup, and ephemeral mode labels', () => {
  const source = read('scripts/dev-splash.html')

  assert.match(source, /modeGreenfield:/)
  assert.match(source, /modeSetup:/)
  assert.match(source, /modeEphemeral:/)
  assert.match(source, /if \(mode === 'greenfield'\) return t\('modeGreenfield'\)/)
  assert.match(source, /if \(mode === 'setup'\) return t\('modeSetup'\)/)
  assert.match(source, /if \(mode === 'ephemeral'\) return t\('modeEphemeral'\)/)
})

test('ephemeral dev runner publishes an explicit splash mode', () => {
  const source = read('scripts/dev-ephemeral.ts')

  assert.match(source, /const splashState = {\s*mode: 'ephemeral',/s)
})
