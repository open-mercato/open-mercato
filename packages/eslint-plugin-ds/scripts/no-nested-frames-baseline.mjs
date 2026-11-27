#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const RULE_ID = 'om-ds/no-nested-frames'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../..')
const baselinePath = path.resolve(scriptDir, '../baselines/no-nested-frames.json')
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--prune') ? 'prune' : 'report'
const jsonFlag = process.argv.indexOf('--json')
const jsonPath = jsonFlag > -1 ? process.argv[jsonFlag + 1] : null

createRequire(import.meta.url)(path.join(repoRoot, 'scripts/typescript-js-require-hook.cjs'))
const { ESLint } = await import('eslint')
const { default: tsParser } = await import('@typescript-eslint/parser')
const { default: plugin, noNestedFramesScope } = await import('../index.js')

function keyOf(entry) {
  return `${entry.file}#${entry.outer}>${entry.inner}`
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
}

function toBaselineEntry({ file, outer, inner, count }) {
  return { file, outer, inner, count }
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return []
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).findings ?? []
}

function writeBaseline(entries) {
  const body = { rule: RULE_ID, findings: sortEntries(entries).map(toBaselineEntry) }
  fs.writeFileSync(baselinePath, `${JSON.stringify(body, null, 2)}\n`)
}

function moduleOf(file) {
  const moduleMatch = /^(packages\/[^/]+|apps\/[^/]+)\/src\/modules\/([^/]+)\//.exec(file)
  if (moduleMatch) return `${moduleMatch[1].split('/')[1]}:${moduleMatch[2]}`
  const uiMatch = /^packages\/ui\/src\/([^/]+)\//.exec(file)
  return uiMatch ? `ui:${uiMatch[1]}` : 'other'
}

async function collectFindings() {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: noNestedFramesScope.files,
        ignores: noNestedFramesScope.ignores,
        linterOptions: { reportUnusedDisableDirectives: 'off' },
        languageOptions: {
          parser: tsParser,
          ecmaVersion: 2022,
          sourceType: 'module',
          parserOptions: { ecmaFeatures: { jsx: true } },
        },
        plugins: { 'om-ds': plugin },
        rules: { [RULE_ID]: 'warn' },
      },
    ],
  })
  const roots = noNestedFramesScope.roots.filter((root) => fs.existsSync(path.join(repoRoot, root)))
  const results = await eslint.lintFiles(roots)
  const found = new Map()
  for (const result of results) {
    const file = path.relative(repoRoot, result.filePath).split(path.sep).join('/')
    for (const message of result.messages) {
      if (message.ruleId !== RULE_ID) continue
      const names = /^Frame `<([^>]+)>` is nested inside frame `<([^>]+)>`/.exec(message.message)
      if (!names) continue
      const entry = { file, outer: names[2], inner: names[1] }
      const existing = found.get(keyOf(entry)) ?? { ...entry, count: 0, lines: [] }
      existing.count += 1
      existing.lines.push(message.line)
      found.set(keyOf(entry), existing)
    }
  }
  return found
}

function total(entries) {
  return entries.reduce((sum, entry) => sum + entry.count, 0)
}

const found = await collectFindings()
const baseline = readBaseline()
const baselineCounts = new Map(baseline.map((entry) => [keyOf(entry), entry.count ?? 1]))
const current = sortEntries([...found.values()])
const fresh = current
  .map((entry) => ({ ...entry, extra: entry.count - (baselineCounts.get(keyOf(entry)) ?? 0) }))
  .filter((entry) => entry.extra > 0)
const stale = baseline
  .map((entry) => ({ ...entry, gone: (entry.count ?? 1) - (found.get(keyOf(entry))?.count ?? 0) }))
  .filter((entry) => entry.gone > 0)

const perModule = new Map()
for (const entry of current) perModule.set(moduleOf(entry.file), (perModule.get(moduleOf(entry.file)) ?? 0) + entry.count)
const files = new Set(current.map((entry) => entry.file))

console.log(`${RULE_ID}: ${total(current)} nested frames in ${files.size} files before the baseline`)
for (const [name, count] of [...perModule].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))) {
  console.log(`  ${name}: ${count}`)
}
if (process.argv.includes('--list')) {
  for (const entry of current) {
    console.log(`  ${entry.outer} > ${entry.inner}\tx${entry.count}\t${entry.file}\t(lines ${entry.lines.join(', ')})`)
  }
}
console.log(`Not in the baseline (new): ${fresh.reduce((sum, entry) => sum + entry.extra, 0)}`)
for (const entry of fresh) console.log(`  + ${entry.outer} > ${entry.inner}\tx${entry.extra}\t${entry.file}`)
console.log(`In the baseline but no longer found (fixed or removed): ${stale.reduce((sum, entry) => sum + entry.gone, 0)}`)
for (const entry of stale) console.log(`  - ${entry.outer} > ${entry.inner}\tx${entry.gone}\t${entry.file}`)

if (jsonPath) {
  fs.writeFileSync(jsonPath, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Wrote the full finding list to ${jsonPath}`)
}

if (mode === 'write') {
  writeBaseline(current)
  console.log(`Wrote ${current.length} entries (${total(current)} nested frames) to ${path.relative(repoRoot, baselinePath)}`)
} else if (mode === 'prune') {
  const kept = baseline
    .map((entry) => ({ ...entry, count: Math.min(entry.count ?? 1, found.get(keyOf(entry))?.count ?? 0) }))
    .filter((entry) => entry.count > 0)
  writeBaseline(kept)
  console.log(`Pruned ${stale.reduce((sum, entry) => sum + entry.gone, 0)} nested frames; ${kept.length} entries remain in ${path.relative(repoRoot, baselinePath)}`)
}
