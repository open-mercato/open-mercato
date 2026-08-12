import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

const repoRoot = path.resolve('.')
const canonicalScript = path.join(repoRoot, '.ai/scripts/ds-health-check.sh')
const skillScript = path.join(repoRoot, '.ai/skills/om-ds-guardian/scripts/ds-health-check.sh')

const ROLLING_REPORT = '.ai/reports/ds-health-latest.txt'
const DATED_REPORT = /^ds-health-\d{4}-\d{2}-\d{2}\.txt$/

// The health check scans `packages/` and `apps/` relative to its working
// directory, so a miniature tree exercises the real script end to end in
// milliseconds instead of grepping the whole monorepo.
function createFixtureTree() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-health-'))
  for (const sub of [
    '.ai/reports',
    'packages/core/src/modules/demo/backend',
    'packages/enterprise/src/modules/other/backend',
    'apps/mercato/src',
  ]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true })
  }
  fs.writeFileSync(
    path.join(dir, 'packages/core/src/modules/demo/backend/page.tsx'),
    'export const A = () => <div className="text-red-500" />\n',
  )
  fs.writeFileSync(
    path.join(dir, 'packages/enterprise/src/modules/other/backend/page.tsx'),
    'export const B = () => <div />\n',
  )
  return dir
}

function runCheck(cwd, script = canonicalScript) {
  const result = spawnSync('bash', [script], { cwd, encoding: 'utf8' })
  assert.equal(
    result.status,
    0,
    `ds-health-check.sh exited ${result.status}. stderr: ${result.stderr}`,
  )
  return result.stdout
}

function deltaSection(stdout) {
  const start = stdout.indexOf('=== DELTA')
  if (start === -1) return ''
  return stdout.slice(start)
}

test('the health check writes one rolling report and never a dated file', () => {
  const dir = createFixtureTree()
  try {
    runCheck(dir)
    runCheck(dir)

    const reports = fs.readdirSync(path.join(dir, '.ai/reports'))
    assert.deepEqual(
      reports,
      ['ds-health-latest.txt'],
      'Each run must overwrite the single rolling report. A dated file would be gitignored under the `.ai/reports/*` rule and silently lost (#5033).',
    )
    assert.ok(
      !reports.some((name) => DATED_REPORT.test(name)),
      'No ds-health-YYYY-MM-DD.txt file may be produced.',
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('the first run reports that there is nothing to compare against', () => {
  const dir = createFixtureTree()
  try {
    const stdout = runCheck(dir)
    assert.match(stdout, /=== First report — no previous data to compare ===/)
    assert.doesNotMatch(stdout, /=== DELTA/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a run that found changes prints them and does not also claim "(no changes)"', () => {
  const dir = createFixtureTree()
  try {
    runCheck(dir)
    fs.writeFileSync(
      path.join(dir, 'packages/core/src/modules/demo/backend/extra.tsx'),
      'export const C = () => <div className="text-green-600 bg-red-100" />\n',
    )
    const delta = deltaSection(runCheck(dir))

    assert.match(delta, /=== DELTA vs previous run \(/)
    assert.match(delta, /^[+-] {2}\S/m, 'The changed metric lines must be printed.')
    assert.doesNotMatch(
      delta,
      /\(no changes\)/,
      'Regression: `set -o pipefail` makes a differing `diff` exit 1, so a trailing `|| echo "(no changes)"` fired on every run — printing the delta and then denying it. The output must be captured and branched on emptiness instead.',
    )
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a run that found nothing reports "(no changes)" and no metric lines', () => {
  const dir = createFixtureTree()
  try {
    runCheck(dir)
    const delta = deltaSection(runCheck(dir))

    assert.match(delta, /\(no changes\)/)
    assert.doesNotMatch(delta, /^[+-] {2}\S/m, 'An unchanged run must not print metric lines.')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('both copies of the health check share the same delta block', () => {
  const extractDelta = (file) => {
    const source = fs.readFileSync(file, 'utf8')
    const start = source.indexOf('# Compare with the previous run')
    assert.notEqual(start, -1, `${file} is missing the delta block.`)
    return source.slice(start, source.indexOf('\nfi\n', start))
  }

  assert.equal(
    extractDelta(skillScript),
    extractDelta(canonicalScript),
    'The om-ds-guardian copy and the canonical .ai/scripts copy must keep identical delta logic — the drift this convention exists to prevent (#5094).',
  )
})
