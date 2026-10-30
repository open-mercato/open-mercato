import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { buildPackage } from '../build-package.mjs'

function writePreviousOutput(packageDir, outputRelativePath, sourceRelativePath) {
  const outputPath = path.join(packageDir, 'dist', outputRelativePath)
  fs.mkdirSync(path.dirname(outputPath), { recursive: true })
  fs.writeFileSync(outputPath, 'export const value = 1\n')
  fs.writeFileSync(`${outputPath}.map`, JSON.stringify({
    version: 3,
    sources: [path.relative(path.dirname(outputPath), path.join(packageDir, sourceRelativePath))],
    mappings: '',
  }))
}

function createPackage(context) {
  const packageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-build-package-'))
  context.after(() => fs.rmSync(packageDir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(packageDir, 'src'))
  fs.mkdirSync(path.join(packageDir, 'dist'))
  fs.writeFileSync(path.join(packageDir, 'src/index.ts'), 'export const value = 2\n')
  writePreviousOutput(packageDir, 'index.js', 'src/index.ts')
  return packageDir
}

test('clean builds keep existing runtime modules available until replacement', async (context) => {
  const packageDir = createPackage(context)
  const outputPath = path.join(packageDir, 'dist/index.js')

  await buildPackage(packageDir, {
    clearDist: true,
    beforeBuild() {
      assert.equal(fs.readFileSync(outputPath, 'utf8'), 'export const value = 1\n')
    },
  })

  assert.match(fs.readFileSync(outputPath, 'utf8'), /value = 2/)
})

test('compilation failure preserves previously built runtime modules', async (context) => {
  const packageDir = createPackage(context)
  fs.writeFileSync(path.join(packageDir, 'src/index.ts'), 'export const =\n')

  await assert.rejects(buildPackage(packageDir, { clearDist: true, esbuildOverrides: { logLevel: 'silent' } }))

  assert.equal(fs.readFileSync(path.join(packageDir, 'dist/index.js'), 'utf8'), 'export const value = 1\n')
})

test('successful clean builds remove obsolete files and retain current assets', async (context) => {
  const packageDir = createPackage(context)
  writePreviousOutput(packageDir, 'obsolete/removed.js', 'src/obsolete/removed.ts')
  fs.writeFileSync(path.join(packageDir, 'src/settings.json'), '{"enabled":true}\n')

  await buildPackage(packageDir, {
    clearDist: true,
    copyJson: true,
    afterBuild({ outdir }) {
      fs.writeFileSync(path.join(outdir, 'asset.txt'), 'current asset')
    },
  })

  assert.equal(fs.existsSync(path.join(packageDir, 'dist/obsolete/removed.js')), false)
  assert.equal(fs.readFileSync(path.join(packageDir, 'dist/settings.json'), 'utf8'), '{"enabled":true}\n')
  assert.equal(fs.readFileSync(path.join(packageDir, 'dist/asset.txt'), 'utf8'), 'current asset')
})

test('clean builds resolve a directory replaced by a source file against current outputs', async (context) => {
  const packageDir = createPackage(context)
  fs.writeFileSync(path.join(packageDir, 'src/index.ts'), 'export { value } from "./value"\n')
  fs.writeFileSync(path.join(packageDir, 'src/value.ts'), 'export const value = 2\n')
  writePreviousOutput(packageDir, 'value/index.js', 'src/value/index.ts')

  await buildPackage(packageDir, { clearDist: true })

  assert.match(fs.readFileSync(path.join(packageDir, 'dist/index.js'), 'utf8'), /from "\.\/value\.js"/)
  assert.equal(fs.existsSync(path.join(packageDir, 'dist/value/index.js')), false)
})

test('overlapping clean builds retain runtime modules and files created by another writer', async (context) => {
  const packageDir = createPackage(context)
  writePreviousOutput(packageDir, 'obsolete/removed.js', 'src/obsolete/removed.ts')
  let releaseFirst
  let markFirstReady
  const firstReady = new Promise((resolve) => { markFirstReady = resolve })
  const firstRelease = new Promise((resolve) => { releaseFirst = resolve })
  const firstBuild = buildPackage(packageDir, {
    clearDist: true,
    async beforeBuild() {
      markFirstReady()
      await firstRelease
    },
  })

  await firstReady
  try {
    await buildPackage(packageDir, {
      clearDist: true,
      beforeBuild() {
        assert.equal(fs.existsSync(path.join(packageDir, 'dist/index.js')), true)
      },
      afterBuild({ outdir }) {
        fs.mkdirSync(path.join(outdir, 'obsolete'), { recursive: true })
        fs.writeFileSync(path.join(outdir, 'obsolete/concurrent.txt'), 'another writer')
      },
    })
  } finally {
    releaseFirst()
    await firstBuild
  }

  assert.match(fs.readFileSync(path.join(packageDir, 'dist/index.js'), 'utf8'), /value = 2/)
  assert.equal(fs.readFileSync(path.join(packageDir, 'dist/obsolete/concurrent.txt'), 'utf8'), 'another writer')
})

test('base builds preserve runtime modules emitted from other source roots', async (context) => {
  const packageDir = createPackage(context)
  writePreviousOutput(packageDir, 'generated/registry.js', 'generated/registry.ts')
  writePreviousOutput(packageDir, 'server/collaboration.js', 'server/collaboration.ts')

  await buildPackage(packageDir, {
    clearDist: true,
    afterBuild({ outdir }) {
      assert.match(fs.readFileSync(path.join(outdir, 'generated/registry.js'), 'utf8'), /value = 1/)
      assert.match(fs.readFileSync(path.join(outdir, 'server/collaboration.js'), 'utf8'), /value = 1/)
    },
  })

  assert.equal(fs.existsSync(path.join(packageDir, 'dist/generated/registry.js.map')), true)
  assert.equal(fs.existsSync(path.join(packageDir, 'dist/server/collaboration.js.map')), true)
})

test('base compilation preserves copied assets and outputs without valid ownership metadata', async (context) => {
  const packageDir = createPackage(context)
  fs.writeFileSync(path.join(packageDir, 'dist/settings.json'), '{"enabled":true}\n')
  fs.writeFileSync(path.join(packageDir, 'dist/asset.txt'), 'current asset')
  fs.writeFileSync(path.join(packageDir, 'dist/unmapped.js'), 'export const otherPhase = true\n')
  fs.writeFileSync(path.join(packageDir, 'dist/unmapped.js.map'), 'invalid source map')

  await buildPackage(packageDir, {
    clearDist: true,
    afterBuild({ outdir }) {
      assert.equal(fs.readFileSync(path.join(outdir, 'settings.json'), 'utf8'), '{"enabled":true}\n')
      assert.equal(fs.readFileSync(path.join(outdir, 'asset.txt'), 'utf8'), 'current asset')
      assert.match(fs.readFileSync(path.join(outdir, 'unmapped.js'), 'utf8'), /otherPhase = true/)
    },
  })
})
