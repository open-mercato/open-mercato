import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-agents-md-budget.mjs')
const BASELINE = path.join(ROOT, 'scripts', 'agents-md-budget.baseline.json')

function runChecker(cwdRoot, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, '--root', cwdRoot, ...extraArgs], { encoding: 'utf8' })
}

function makeFixture({ rootBytes, nestedBytes, baselineNestedBytes, budgetBytes = 200, rootMaxBytes = 100 }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-budget-'))
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'x'.repeat(rootBytes))
  const nestedDir = path.join(dir, 'packages', 'demo')
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(path.join(nestedDir, 'AGENTS.md'), 'y'.repeat(nestedBytes))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'scripts', 'agents-md-budget.baseline.json'),
    `${JSON.stringify({ budgetBytes, rootMaxBytes, chains: { 'packages/demo': baselineNestedBytes } }, null, 2)}\n`,
  )
  return dir
}

test('passes when the root file is under its limit and no over-budget chain grew', () => {
  const fixture = makeFixture({ rootBytes: 80, nestedBytes: 50, baselineNestedBytes: 130 })
  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /AGENTS\.md: 80 bytes \/ 100 limit/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('fails when the root AGENTS.md exceeds the root limit', () => {
  const fixture = makeFixture({ rootBytes: 120, nestedBytes: 10, baselineNestedBytes: 130 })
  const result = runChecker(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /over the 100-byte root limit/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('fails when the nested part of an already over-budget chain grows beyond its baseline', () => {
  const fixture = makeFixture({ rootBytes: 80, nestedBytes: 400, baselineNestedBytes: 300 })
  const result = runChecker(fixture)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /packages\/demo is already \d+ bytes over/)
  assert.match(result.stderr, /--update-baseline/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('allows a chain that is still inside the budget to grow', () => {
  const fixture = makeFixture({ rootBytes: 80, nestedBytes: 100, baselineNestedBytes: 50 })
  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('growing the root file within its limit does not trip the chain ratchet', () => {
  const fixture = makeFixture({ rootBytes: 99, nestedBytes: 400, baselineNestedBytes: 400 })
  const result = runChecker(fixture)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('--update-baseline re-records the measured chain sizes', () => {
  const fixture = makeFixture({ rootBytes: 80, nestedBytes: 400, baselineNestedBytes: 300 })
  const result = runChecker(fixture, ['--update-baseline'])
  assert.equal(result.status, 0, result.stderr)
  const written = JSON.parse(fs.readFileSync(path.join(fixture, 'scripts', 'agents-md-budget.baseline.json'), 'utf8'))
  assert.equal(written.chains['packages/demo'], 400)
  assert.equal(runChecker(fixture).status, 0)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('the repository itself satisfies the agent instruction budget', () => {
  const result = runChecker(ROOT)
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
})

test('the committed root AGENTS.md fits Codex\'s default project_doc_max_bytes', () => {
  const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
  const rootBytes = fs.statSync(path.join(ROOT, 'AGENTS.md')).size
  assert.equal(baseline.budgetBytes, 32768, 'budgetBytes must track Codex\'s documented default')
  assert.ok(
    rootBytes < baseline.budgetBytes,
    `root AGENTS.md is ${rootBytes} bytes — Codex would truncate it at ${baseline.budgetBytes}`,
  )
  assert.ok(baseline.rootMaxBytes < baseline.budgetBytes, 'the root limit must reserve budget for nested files')
})
