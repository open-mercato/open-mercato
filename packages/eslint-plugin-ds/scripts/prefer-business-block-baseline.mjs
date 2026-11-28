#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const RULE_ID = 'om-ds/prefer-business-block'
const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../../..')
const baselinePath = path.resolve(scriptDir, '../baselines/prefer-business-block.json')
const mode = process.argv.includes('--write') ? 'write' : process.argv.includes('--prune') ? 'prune' : 'report'

createRequire(import.meta.url)(path.join(repoRoot, 'scripts/typescript-js-require-hook.cjs'))
const { ESLint } = await import('eslint')
const { default: tsParser } = await import('@typescript-eslint/parser')
const { default: plugin, preferBusinessBlockScope } = await import('../index.js')

function keyOf(entry) {
  return `${entry.file}#${entry.block}`
}

function sortEntries(entries) {
  return [...entries].sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
}

function readBaseline() {
  if (!fs.existsSync(baselinePath)) return []
  return JSON.parse(fs.readFileSync(baselinePath, 'utf8')).findings ?? []
}

function writeBaseline(entries) {
  const body = { rule: RULE_ID, findings: sortEntries(entries) }
  fs.writeFileSync(baselinePath, `${JSON.stringify(body, null, 2)}\n`)
}

async function collectFindings() {
  const eslint = new ESLint({
    cwd: repoRoot,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: preferBusinessBlockScope.files,
        ignores: preferBusinessBlockScope.ignores,
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
  const roots = preferBusinessBlockScope.roots.filter((root) => fs.existsSync(path.join(repoRoot, root)))
  const results = await eslint.lintFiles(roots)
  const found = new Map()
  for (const result of results) {
    const file = path.relative(repoRoot, result.filePath).split(path.sep).join('/')
    for (const message of result.messages) {
      if (message.ruleId !== RULE_ID) continue
      const block = /`([a-z-]+)` block/.exec(message.message)?.[1]
      if (!block) continue
      const entry = { file, block }
      const existing = found.get(keyOf(entry)) ?? { ...entry, count: 0, lines: [] }
      existing.count += 1
      existing.lines.push(message.line)
      found.set(keyOf(entry), existing)
    }
  }
  return found
}

const found = await collectFindings()
const baseline = readBaseline()
const baselineKeys = new Set(baseline.map(keyOf))
const current = sortEntries([...found.values()])
const fresh = current.filter((entry) => !baselineKeys.has(keyOf(entry)))
const stale = baseline.filter((entry) => !found.has(keyOf(entry)))

const perBlock = new Map()
for (const entry of current) perBlock.set(entry.block, (perBlock.get(entry.block) ?? 0) + 1)

console.log(`${RULE_ID}: ${current.length} file and block pairs before the baseline`)
for (const [block, count] of [...perBlock].sort()) console.log(`  ${block}: ${count}`)
if (process.argv.includes('--list')) {
  for (const entry of current) console.log(`  ${entry.block}\t${entry.file}\t(lines ${entry.lines.join(', ')})`)
}
console.log(`Not in the baseline (new): ${fresh.length}`)
for (const entry of fresh) console.log(`  + ${entry.block}\t${entry.file}`)
console.log(`In the baseline but no longer found (adopted or removed): ${stale.length}`)
for (const entry of stale) console.log(`  - ${entry.block}\t${entry.file}`)

if (mode === 'write') {
  writeBaseline(current.map(({ file, block }) => ({ file, block })))
  console.log(`Wrote ${current.length} entries to ${path.relative(repoRoot, baselinePath)}`)
} else if (mode === 'prune') {
  const kept = baseline.filter((entry) => found.has(keyOf(entry)))
  writeBaseline(kept)
  console.log(`Pruned ${stale.length} entries; ${kept.length} remain in ${path.relative(repoRoot, baselinePath)}`)
}
