import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { discoverIntegrationSpecFiles } from '../../packages/cli/src/lib/testing/integration-discovery'
import { selectStandaloneSpecs } from '../lib/standalone-pr-gate.mjs'

const [suite, baseRef, outputPath] = process.argv.slice(2)
if (!suite || !outputPath) throw new Error('Usage: select-standalone-tests.ts <suite> <base-ref-or-empty> <output-path>')
let changedPaths: string[] = []
if (suite === 'affected') {
  if (!baseRef) throw new Error('Affected standalone tests require a base ref')
  const diff = spawnSync('git', ['diff', '--name-only', '-z', `${baseRef}...HEAD`], { encoding: 'utf8' })
  if (diff.status !== 0) throw new Error(`Cannot determine affected standalone tests: ${diff.stderr}`)
  changedPaths = diff.stdout.split('\0').filter(Boolean)
}
const root = process.cwd()
const discoveryExcluded: { path: string; reason: string; details: string[] }[] = []
const discovered = discoverIntegrationSpecFiles(root, path.join(root, '.ai', 'qa', 'tests', '__legacy_disabled__'), {
  onExcluded: (entry) => discoveryExcluded.push(entry),
})
const selection = selectStandaloneSpecs(discovered, changedPaths, suite)
selection.excluded.push(...discoveryExcluded)
selection.excluded.sort((left, right) => left.path.localeCompare(right.path))
fs.mkdirSync(path.dirname(outputPath), { recursive: true })
fs.writeFileSync(outputPath, `${JSON.stringify(selection, null, 2)}\n`)
console.log(`Standalone tests: ${selection.selected.length} selected; ${selection.excluded.length} excluded; full suite: ${selection.fullSuite}`)
