import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

function readJson(relativeUrl) {
  return JSON.parse(fs.readFileSync(new URL(relativeUrl, import.meta.url), 'utf8'))
}

function extractMaxOldSpaceSize(buildScript) {
  const match = buildScript.match(/--max-old-space-size=(\d+)/)
  return match ? Number(match[1]) : null
}

test('standalone template build script raises the Node heap to match the main app', () => {
  const template = readJson('../../template/package.json.template')
  const mainApp = readJson('../../../../apps/mercato/package.json')

  const mainAppHeap = extractMaxOldSpaceSize(mainApp.scripts.build)
  const templateHeap = extractMaxOldSpaceSize(template.scripts.build)

  assert.ok(
    mainAppHeap && mainAppHeap > 0,
    'expected apps/mercato build script to set --max-old-space-size',
  )
  assert.ok(
    templateHeap && templateHeap > 0,
    'expected standalone template build script to set --max-old-space-size (prevents OOM during next build)',
  )
  assert.ok(
    templateHeap >= mainAppHeap,
    `standalone template heap (${templateHeap} MB) must be >= main app heap (${mainAppHeap} MB)`,
  )
})

test('standalone template ships cross-env so the heap flag works cross-platform', () => {
  const template = readJson('../../template/package.json.template')
  const declared =
    template.dependencies?.['cross-env'] ?? template.devDependencies?.['cross-env']

  assert.ok(
    declared,
    'expected standalone template to declare cross-env (used by the build script NODE_OPTIONS prefix)',
  )
  assert.ok(
    template.scripts.build.includes('cross-env'),
    'expected standalone template build script to invoke cross-env',
  )
})
