import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { runConsolidatedWatch } from '../watch-packages.mjs'

function makePackage(rootDir, parentSubdir, pkgName, options = {}) {
  const pkgDir = path.join(rootDir, parentSubdir, pkgName)
  fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: `@workspace/${pkgName}`,
      version: '0.0.0',
      scripts: { watch: 'node watch.mjs' },
    }),
  )
  if (options.entryFile) {
    fs.writeFileSync(path.join(pkgDir, 'src', options.entryFile), '')
  }
  return pkgDir
}

test('runConsolidatedWatch honors OM_WATCH_SCOPE=env and tracks only the listed packages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-scope-env-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'bravo', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'charlie', { entryFile: 'index.ts' })

    const logs = []
    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log: (line) => logs.push(String(line)),
      build: async () => {},
      watch: () => ({ close() {} }),
      signal: controller.signal,
      env: { OM_WATCH_SCOPE: 'env', OM_WATCH_PACKAGES: 'alpha,charlie' },
      argv: [],
    })
    controller.abort()

    assert.deepEqual(packages.map((p) => p.shortLabel).sort(), ['alpha', 'charlie'])
    assert.ok(
      logs.some((line) => /watch scope: \S+ env\b/.test(line)),
      `expected watch scope log, got: ${logs.join('\n')}`,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch auto-optimized tracks only git-touched packages at startup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-scope-auto-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'bravo', { entryFile: 'index.ts' })

    const runGit = (_root, args) => {
      if (args[0] === 'status') return ' M packages/bravo/src/index.ts\n'
      return ''
    }
    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log: () => {},
      build: async () => {},
      watch: () => ({ close() {} }),
      signal: controller.signal,
      env: { OM_WATCH_SCOPE: 'auto-optimized' },
      argv: [],
      runGit,
    })
    controller.abort()

    assert.deepEqual(packages.map((p) => p.shortLabel), ['bravo'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
