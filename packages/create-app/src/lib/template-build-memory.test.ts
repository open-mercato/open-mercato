import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

function readJson(relativeUrl) {
  return JSON.parse(fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

function extractMaxOldSpaceSize(options) {
  const match = options.match(/--max-old-space-size=(\d+)/)
  return match ? Number(match[1]) : null
}

const wrappers = {
  main: '../../../../apps/mercato/scripts/build-next.mjs',
  template: '../../template/scripts/build-next.mjs',
}

// Run the shipped wrapper against a tiny Next replacement. This checks the real
// child environment even when package scripts delegate instead of spelling it out.
function executeBuild(t, wrapper, override) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'om-template-build-memory-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.copyFileSync(new URL(wrapper, import.meta.url), path.join(dir, 'scripts/build-next.mjs'))
  fs.mkdirSync(path.join(dir, 'node_modules/next/dist/bin'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules/next/dist/bin/next'),
    'process.stdout.write(JSON.stringify({ options: process.env.NODE_OPTIONS, nodeEnv: process.env.NODE_ENV, args: process.argv.slice(2) }))')
  const env = { ...process.env, NODE_ENV: 'development', NODE_OPTIONS: '--max-old-space-size=512' }
  delete env.OM_BUILD_NODE_OPTIONS
  if (override !== undefined) env.OM_BUILD_NODE_OPTIONS = override
  const child = spawnSync(process.execPath, [path.join(dir, 'scripts/build-next.mjs')], { cwd: dir, env, encoding: 'utf8' })
  assert.equal(child.status, 0, child.stderr)
  return JSON.parse(child.stdout)
}

test('standalone template and main app build wrappers preserve the 8192 MB host default', (t) => {
  const mainApp = readJson('../../../../apps/mercato/package.json')
  const template = readJson('../../template/package.json.template')
  assert.match(mainApp.scripts.build, /node \.\/scripts\/build-next\.mjs/)
  assert.match(template.scripts.build, /node \.\/scripts\/build-next\.mjs/)
  const mainHeap = extractMaxOldSpaceSize(executeBuild(t, wrappers.main).options)
  const templateHeap = extractMaxOldSpaceSize(executeBuild(t, wrappers.template).options)
  assert.equal(mainHeap, 8192)
  assert.equal(templateHeap, 8192, 'standalone build must retain its 8 GiB heap headroom')
  assert.ok(templateHeap >= mainHeap)
})

test('standalone template ships cross-env for cross-platform build and typecheck settings', () => {
  const template = readJson('../../template/package.json.template')
  assert.ok(template.dependencies?.['cross-env'] ?? template.devDependencies?.['cross-env'])
  assert.match(template.scripts.build, /cross-env\s+NODE_ENV=production\s+node /)
  assert.match(template.scripts.typecheck, /cross-env\s+NODE_OPTIONS=/)
})

test('standalone template typecheck retains the same 8192 MB heap as its actual build child', (t) => {
  const template = readJson('../../template/package.json.template')
  const buildHeap = extractMaxOldSpaceSize(executeBuild(t, wrappers.template).options)
  const typecheckHeap = extractMaxOldSpaceSize(template.scripts.typecheck)
  assert.equal(typecheckHeap, 8192)
  assert.equal(typecheckHeap, buildHeap)
})

for (const [name, wrapper] of Object.entries(wrappers)) {
  test(`${name} Next build forces production from a development parent with default or bounded heap`, (t) => {
    for (const override of [undefined, '--max-old-space-size=4096']) {
      const child = executeBuild(t, wrapper, override)
      assert.equal(child.nodeEnv, 'production', 'development container settings must not reach Next build')
      assert.equal(child.options, override ?? '--max-old-space-size=8192')
      assert.deepEqual(child.args, ['build'])
    }
  })
}
