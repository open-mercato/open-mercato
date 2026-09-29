import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-package-peer-deps.mjs')

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`)
}

/**
 * Build a throwaway repo shaped like this monorepo: `packages/<name>/package.json`
 * for the workspace packages, and a hoisted `node_modules/<dep>/package.json` for
 * the installed dependencies whose peers the checker reads.
 */
function makeFixture({ packages = {}, installed = {}, allowlist }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-package-peer-deps-'))
  for (const [name, manifest] of Object.entries(packages)) {
    writeJson(path.join(dir, 'packages', name, 'package.json'), manifest)
  }
  for (const [name, manifest] of Object.entries(installed)) {
    writeJson(path.join(dir, 'node_modules', name, 'package.json'), { name, version: '1.0.0', ...manifest })
  }
  if (allowlist) writeJson(path.join(dir, 'scripts', 'package-peer-deps-allowlist.json'), allowlist)
  return dir
}

function runChecker(root, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], { encoding: 'utf8' })
}

function withFixture(options, assertions) {
  const fixture = makeFixture(options)
  try {
    assertions(fixture)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}

test('fails when a runtime dependency has an unmet peer', () => {
  withFixture(
    {
      packages: {
        documents: {
          name: '@scope/documents',
          dependencies: { 'html-renderer': '^3.0.0' },
          devDependencies: { 'happy-dom': '^20.0.0' },
        },
      },
      installed: { 'html-renderer': { peerDependencies: { 'happy-dom': '^20.0.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /@scope\/documents/)
      assert.match(result.stderr, /happy-dom/)
      assert.match(result.stderr, /move it to dependencies/)
    },
  )
})

test('passes when the peer is declared as a runtime dependency', () => {
  withFixture(
    {
      packages: {
        documents: {
          name: '@scope/documents',
          dependencies: { 'html-renderer': '^3.0.0', 'happy-dom': '^20.0.0' },
        },
      },
      installed: { 'html-renderer': { peerDependencies: { 'happy-dom': '^20.0.0' } } },
    },
    (fixture) => {
      assert.equal(runChecker(fixture).status, 0)
    },
  )
})

test('passes when the peer is re-declared as the package own peer', () => {
  withFixture(
    {
      packages: {
        documents: {
          name: '@scope/documents',
          dependencies: { 'html-renderer': '^3.0.0' },
          peerDependencies: { 'happy-dom': '^20.0.0' },
        },
      },
      installed: { 'html-renderer': { peerDependencies: { 'happy-dom': '^20.0.0' } } },
    },
    (fixture) => {
      assert.equal(runChecker(fixture).status, 0)
    },
  )
})

// An optional peer on the package itself is not a fix: consumers are free to skip it, so the
// standalone build breaks exactly as it would with no declaration. Without this the gate could
// be turned green while the regression it exists to catch still ships.
test('rejects a peer the package re-declares as OPTIONAL', () => {
  withFixture(
    {
      packages: {
        documents: {
          name: '@scope/documents',
          dependencies: { 'html-renderer': '^3.0.0' },
          peerDependencies: { 'happy-dom': '^20.0.0' },
          peerDependenciesMeta: { 'happy-dom': { optional: true } },
        },
      },
      installed: { 'html-renderer': { peerDependencies: { 'happy-dom': '^20.0.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /OPTIONAL peer/)
    },
  )
})

// A guard that reports success without having checked anything is worse than no guard.
test('refuses to pass when no dependency manifest can be resolved', () => {
  withFixture(
    {
      packages: {
        documents: { name: '@scope/documents', dependencies: { 'html-renderer': '^3.0.0' } },
      },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /Cannot verify peer dependencies/)
      assert.match(result.stderr, /yarn install/)
    },
  )
})

test('ignores optional peers and private workspaces', () => {
  withFixture(
    {
      packages: {
        documents: { name: '@scope/documents', dependencies: { 'html-renderer': '^3.0.0' } },
        internal: { name: '@scope/internal', private: true, dependencies: { 'html-renderer': '^3.0.0' } },
      },
      installed: {
        'html-renderer': {
          peerDependencies: { 'happy-dom': '^20.0.0' },
          peerDependenciesMeta: { 'happy-dom': { optional: true } },
        },
      },
    },
    (fixture) => {
      assert.equal(runChecker(fixture).status, 0)
    },
  )
})

test('accepts an allowlisted violation and reports stale entries', () => {
  withFixture(
    {
      packages: {
        documents: { name: '@scope/documents', dependencies: { 'html-renderer': '^3.0.0' } },
      },
      installed: { 'html-renderer': { peerDependencies: { 'happy-dom': '^20.0.0' } } },
      allowlist: {
        version: 1,
        accepted: {
          '@scope/documents -> html-renderer -> happy-dom': 'Host application provides it',
          '@scope/gone -> nothing -> nowhere': 'No longer applies',
        },
      },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 0)
      assert.match(result.stdout, /@scope\/gone -> nothing -> nowhere/)
    },
  )
})

test('the repository itself has no unallowlisted unmet peers', () => {
  const result = runChecker(ROOT)
  assert.equal(result.status, 0, result.stderr)
})
