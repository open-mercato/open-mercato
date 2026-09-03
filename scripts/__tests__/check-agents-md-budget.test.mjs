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

function makeFixture({
  rootBytes,
  nestedBytes,
  baselineNestedBytes,
  budgetBytes = 200,
  rootMaxBytes = 100,
  warnAtPercent,
  tools,
}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-budget-'))
  fs.writeFileSync(path.join(dir, 'AGENTS.md'), 'x'.repeat(rootBytes))
  const nestedDir = path.join(dir, 'packages', 'demo')
  fs.mkdirSync(nestedDir, { recursive: true })
  fs.writeFileSync(path.join(nestedDir, 'AGENTS.md'), 'y'.repeat(nestedBytes))
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true })
  const baseline = { budgetBytes, rootMaxBytes, chains: { 'packages/demo': baselineNestedBytes } }
  if (warnAtPercent !== undefined) baseline.warnAtPercent = warnAtPercent
  if (tools !== undefined) baseline.tools = tools
  fs.writeFileSync(path.join(dir, 'scripts', 'agents-md-budget.baseline.json'), `${JSON.stringify(baseline, null, 2)}\n`)
  return dir
}

const BYTE_TOOL = { demo: { unit: 'bytes', limit: 200, enforced: true, source: 'fixture' } }

function writeCoverageAllowlist(fixture, paths) {
  fs.writeFileSync(
    path.join(fixture, 'scripts', 'agents-md-coverage-allowlist.json'),
    `${JSON.stringify({ version: 1, paths }, null, 2)}\n`,
  )
}

/** A workspace package with two modules, so module-level sheets are expected. */
function addPackageWithModules(fixture, packageName, moduleNames) {
  const packageDir = path.join(fixture, 'packages', packageName)
  fs.mkdirSync(packageDir, { recursive: true })
  fs.writeFileSync(path.join(packageDir, 'package.json'), '{}')
  fs.writeFileSync(path.join(packageDir, 'AGENTS.md'), 'p')
  for (const moduleName of moduleNames) {
    fs.mkdirSync(path.join(packageDir, 'src', 'modules', moduleName), { recursive: true })
  }
  return packageDir
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
  // The headroom warning is suppressed once the hard limit is already breached: the blocking
  // failure says the same thing louder, and repeating it as advice would read as a second problem.
  assert.doesNotMatch(result.stdout, /root-headroom/)
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

test('stays silent below the warn threshold and warns at or above it', () => {
  const quiet = makeFixture({ rootBytes: 89, nestedBytes: 10, baselineNestedBytes: 10, warnAtPercent: 90 })
  const quietResult = runChecker(quiet)
  assert.equal(quietResult.status, 0, quietResult.stderr)
  assert.doesNotMatch(quietResult.stdout, /root-headroom/)
  fs.rmSync(quiet, { recursive: true, force: true })

  const loud = makeFixture({ rootBytes: 91, nestedBytes: 10, baselineNestedBytes: 10, warnAtPercent: 90 })
  const loudResult = runChecker(loud)
  assert.equal(loudResult.status, 0, loudResult.stderr)
  assert.match(loudResult.stdout, /\[root-headroom\].*91% of its 100-byte limit/)
  fs.rmSync(loud, { recursive: true, force: true })
})

test('a warning-only run exits 0, and the same run exits 1 under --strict', () => {
  const fixture = makeFixture({ rootBytes: 95, nestedBytes: 10, baselineNestedBytes: 10, warnAtPercent: 90 })
  assert.equal(runChecker(fixture).status, 0)

  const strict = runChecker(fixture, ['--strict'])
  assert.equal(strict.status, 1)
  assert.match(strict.stderr, /strict mode: 1 advisory finding/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('warns about an individually oversized nested AGENTS.md the chain ratchet lets pass', () => {
  // The chain is under budget, so nothing blocks — but the single file is 90% of the tool limit.
  const fixture = makeFixture({ rootBytes: 10, nestedBytes: 185, baselineNestedBytes: 185, tools: BYTE_TOOL })
  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\[file-size\] packages\/demo\/AGENTS\.md is 185 bytes.*93% of demo's 200-byte hard limit/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('a token-unit limit is reported as an estimate and never blocks on its own', () => {
  const fixture = makeFixture({
    rootBytes: 10,
    nestedBytes: 100,
    baselineNestedBytes: 100,
    tools: { 'demo-llm': { unit: 'tokens', limit: 20, enforced: false, source: 'fixture policy budget' } },
  })
  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /25 est\. tokens = 125% of demo-llm's 20-token policy budget/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('rejects a tool limit that does not cite where it came from', () => {
  const fixture = makeFixture({
    rootBytes: 10,
    nestedBytes: 10,
    baselineNestedBytes: 10,
    tools: { demo: { unit: 'bytes', limit: 200, enforced: true, source: '  ' } },
  })
  const result = runChecker(fixture)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /tools\.demo\.source must cite where the limit comes from/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('rejects a non-boolean enforced flag rather than silently downgrading the limit', () => {
  const fixture = makeFixture({
    rootBytes: 10,
    nestedBytes: 10,
    baselineNestedBytes: 10,
    tools: { demo: { unit: 'bytes', limit: 200, enforced: 'true', source: 'fixture' } },
  })
  const result = runChecker(fixture)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /tools\.demo\.enforced must be a boolean/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('--update-baseline still surfaces the advisory findings', () => {
  const fixture = makeFixture({ rootBytes: 95, nestedBytes: 10, baselineNestedBytes: 10, warnAtPercent: 90 })
  const result = runChecker(fixture, ['--update-baseline'])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\[root-headroom\]/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('warns about a module directory with no AGENTS.md, and stays silent once allowlisted', () => {
  const fixture = makeFixture({ rootBytes: 10, nestedBytes: 10, baselineNestedBytes: 10 })
  addPackageWithModules(fixture, 'shop', ['orders', 'invoices'])
  fs.writeFileSync(path.join(fixture, 'packages', 'shop', 'src', 'modules', 'orders', 'AGENTS.md'), 'o')

  const flagged = runChecker(fixture)
  assert.equal(flagged.status, 0, flagged.stderr)
  assert.match(flagged.stdout, /\[coverage\] packages\/shop\/src\/modules\/invoices is a module with no AGENTS\.md/)
  assert.doesNotMatch(flagged.stdout, /modules\/orders is a module/)

  writeCoverageAllowlist(fixture, { 'packages/shop/src/modules/invoices': 'Fixture module, documented elsewhere.' })
  const allowlisted = runChecker(fixture)
  assert.equal(allowlisted.status, 0, allowlisted.stderr)
  assert.doesNotMatch(allowlisted.stdout, /\[coverage\]/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('treats a package that ships exactly one module as that module', () => {
  const fixture = makeFixture({ rootBytes: 10, nestedBytes: 10, baselineNestedBytes: 10 })
  addPackageWithModules(fixture, 'solo', ['solo'])
  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.doesNotMatch(result.stdout, /\[coverage\]/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('rejects a coverage allowlist entry with an empty reason', () => {
  const fixture = makeFixture({ rootBytes: 10, nestedBytes: 10, baselineNestedBytes: 10 })
  addPackageWithModules(fixture, 'shop', ['orders', 'invoices'])
  writeCoverageAllowlist(fixture, { 'packages/shop/src/modules/invoices': '   ' })
  const result = runChecker(fixture)
  assert.equal(result.status, 2)
  assert.match(result.stderr, /needs a non-empty reason/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('reports an allowlist entry as stale once its directory gains an AGENTS.md', () => {
  const fixture = makeFixture({ rootBytes: 10, nestedBytes: 10, baselineNestedBytes: 10 })
  addPackageWithModules(fixture, 'shop', ['orders', 'invoices'])
  fs.writeFileSync(path.join(fixture, 'packages', 'shop', 'src', 'modules', 'orders', 'AGENTS.md'), 'o')
  fs.writeFileSync(path.join(fixture, 'packages', 'shop', 'src', 'modules', 'invoices', 'AGENTS.md'), 'i')
  writeCoverageAllowlist(fixture, { 'packages/shop/src/modules/invoices': 'Fixture module, documented elsewhere.' })

  const result = runChecker(fixture)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /\[coverage-allowlist-stale\] packages\/shop\/src\/modules\/invoices now has an AGENTS\.md/)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('--update-baseline preserves the advisory keys it does not manage', () => {
  const fixture = makeFixture({
    rootBytes: 80,
    nestedBytes: 400,
    baselineNestedBytes: 300,
    warnAtPercent: 75,
    tools: BYTE_TOOL,
  })
  assert.equal(runChecker(fixture, ['--update-baseline']).status, 0)
  const written = JSON.parse(fs.readFileSync(path.join(fixture, 'scripts', 'agents-md-budget.baseline.json'), 'utf8'))
  assert.equal(written.chains['packages/demo'], 400)
  assert.equal(written.warnAtPercent, 75)
  assert.deepEqual(written.tools, BYTE_TOOL)
  fs.rmSync(fixture, { recursive: true, force: true })
})

test('the committed coverage allowlist gives every entry a real reason', () => {
  const allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'agents-md-coverage-allowlist.json'), 'utf8'))
  const entries = Object.entries(allowlist.paths)
  assert.ok(entries.length > 0, 'the seeded allowlist should not be empty')
  for (const [relativePath, reason] of entries) {
    assert.equal(typeof reason, 'string', `${relativePath} must carry a reason`)
    assert.ok(reason.trim().length > 20, `${relativePath} needs a real reason, got: ${reason}`)
  }
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
