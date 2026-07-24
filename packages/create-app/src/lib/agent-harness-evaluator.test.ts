import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sharedRoot = fileURLToPath(new URL('../../agentic/shared/', import.meta.url))
const guidesRoot = fileURLToPath(new URL('../../agentic/guides/', import.meta.url))
const sourceHarness = path.join(sharedRoot, 'ai', 'harness')
const sourceEvaluator = path.join(sharedRoot, 'scripts', 'evaluate-agent-harness.mjs')

type HarnessCase = {
  id: string
  evaluationKind: string
  owner: { ruleIds: string[] }
  validators: string[]
  fixture?: unknown
}

function stageApp(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-eval-')))
  fs.cpSync(path.join(sharedRoot, 'ai'), path.join(root, '.ai'), { recursive: true })
  fs.cpSync(guidesRoot, path.join(root, '.ai', 'guides'), { recursive: true })
  fs.copyFileSync(path.join(sharedRoot, 'AGENTS.md.template'), path.join(root, 'AGENTS.md'))
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(sourceEvaluator, path.join(root, 'scripts', 'evaluate-agent-harness.mjs'))
  return root
}

function runEvaluator(root: string, args: string[] = [], env: NodeJS.ProcessEnv = process.env) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'evaluate-agent-harness.mjs'), '--root', root, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  })
}

test('the catalog contains exactly the specified 92 cases, fixed writable matrix, mandatory set, and all BC rules', () => {
  const cases = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'cases.json'), 'utf8')) as HarnessCase[]
  const validators = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'validators.json'), 'utf8')) as {
    catalog: { backwardCompatibilityRuleIds: string[]; mandatoryCaseIds: string[]; writableCaseIds: string[] }
  }
  const matrix = JSON.parse(fs.readFileSync(path.join(sourceHarness, 'release-matrix.json'), 'utf8')) as {
    routing: { codex: { caseIds: string }; claude: { caseIds: string[] } }
    writable: Array<{ caseId: string; runner: string }>
  }
  assert.equal(cases.length, 92)
  assert.deepEqual(cases.map((entry) => entry.id), Array.from({ length: 92 }, (_, index) => `OMH-${String(index + 1).padStart(3, '0')}`))
  assert.deepEqual(cases.filter((entry) => entry.fixture).map((entry) => entry.id), validators.catalog.writableCaseIds)
  assert.deepEqual(matrix.routing.claude.caseIds, validators.catalog.writableCaseIds)
  assert.equal(matrix.routing.codex.caseIds, 'all')
  assert.deepEqual(matrix.writable.map((entry) => entry.caseId), validators.catalog.writableCaseIds)
  assert.deepEqual(
    [...new Set(cases.flatMap((entry) => entry.owner.ruleIds))].sort(),
    validators.catalog.backwardCompatibilityRuleIds,
  )
  assert.deepEqual(
    cases.filter((entry) => entry.validators.includes('safety.mandatory')).map((entry) => entry.id),
    validators.catalog.mandatoryCaseIds,
  )
})

test('deterministic evaluation passes every concrete catalog case in an emitted-layout fixture', () => {
  const root = stageApp()
  try {
    const result = runEvaluator(root, ['--all'])
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /Deterministic: 92\/92 selected cases passed/)
    assert.equal((result.stdout.match(/^PASS OMH-/gm) ?? []).length, 92)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('deterministic evaluation rejects dangling relations, excessive budgets, and unsafe fixture setup', () => {
  const root = stageApp()
  try {
    const casesPath = path.join(root, '.ai', 'harness', 'cases.json')
    const cases = JSON.parse(fs.readFileSync(casesPath, 'utf8')) as Array<{
      relatedCases: string[]
      maxTotalContextBytes: number
      fixture: { setup: string[] }
    }>
    cases[0].relatedCases = ['OMH-999']
    cases[1].maxTotalContextBytes = 999_999
    cases[8].fixture.setup = ['node dangerous-script.mjs']
    fs.writeFileSync(casesPath, `${JSON.stringify(cases, null, 2)}\n`)
    const result = runEvaluator(root, ['--all'])
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /dangling related case OMH-999/)
    assert.match(result.stderr, /maxTotalContextBytes is invalid/)
    assert.match(result.stderr, /unsafe fixture setup/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('live Codex adapter starts one ephemeral read-only process and stores only a sanitized structured result', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const fake = path.join(bin, 'codex')
  fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
if (!args.includes('--ephemeral') || !args.includes('--json') || args[args.indexOf('--sandbox') + 1] !== 'read-only') process.exit(9)
const output = args[args.indexOf('-o') + 1]
fs.writeFileSync(output, JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
`)
  fs.chmodSync(fake, 0o755)
  try {
    const result = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /PASS OMH-001/)
    const results = fs.readdirSync(path.join(root, '.ai', 'harness', 'results'))
    assert.equal(results.length, 1)
    const stored = fs.readFileSync(path.join(root, '.ai', 'harness', 'results', results[0]), 'utf8')
    assert.doesNotMatch(stored, /freshly scaffolded standalone Open Mercato app/)
    assert.doesNotMatch(stored, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.match(stored, /"promptHash": "[a-f0-9]{64}"/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('live Claude adapter uses plan mode, a read-only tool list, structured output, and no persistence', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const fake = path.join(bin, 'claude')
  fs.writeFileSync(fake, `#!/usr/bin/env node
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('claude-fake 1.0'); process.exit(0) }
if (args[args.indexOf('--permission-mode') + 1] !== 'plan' || args[args.indexOf('--tools') + 1] !== 'Read,Glob,Grep' || !args.includes('--no-session-persistence') || !args.includes('--json-schema')) process.exit(9)
console.log(JSON.stringify({ structured_output: {
  selectedRouter: ['module-data'], selectedSkills: ['om-data-model-design'],
  selectedContext: ['AGENTS.md', '.ai/guides/contracts.md', '.ai/skills/om-data-model-design/SKILL.md'],
  decisions: ['tenant-scope', 'optimistic-lock', 'migration-snapshot'], violations: []
}}))
`)
  fs.chmodSync(fake, 0o755)
  try {
    const result = runEvaluator(root, ['--runner', 'claude', '--case', 'OMH-009'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout, /PASS OMH-009/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('writable mode remains explicit and refuses a target without acknowledgement', () => {
  const root = stageApp()
  try {
    const result = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-009', '--writable-root', root])
    assert.equal(result.status, 2)
    assert.match(result.stderr, /requires --acknowledge-writes/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
