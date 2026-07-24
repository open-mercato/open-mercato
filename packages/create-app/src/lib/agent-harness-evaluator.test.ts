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
const sourceFixturePreparer = path.join(sharedRoot, 'scripts', 'prepare-agent-harness-fixture.mjs')
const typescriptPackageRoot = path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json')))

type HarnessCase = {
  id: string
  evaluationKind: string
  owner: { ruleIds: string[] }
  validators: string[]
  fixture?: unknown
}

type StoredResult = {
  status: string
  runnerVersion: string
  model: string
  selectedSkills: string[]
  selectedContext: string[]
  decisions: string[]
  violations: string[]
  sanitizedError?: string
  actualContext: { paths: string[]; bytes: number; initialBytes: number }
  declaredContext: { paths: string[]; bytes: number; initialBytes: number }
  writable?: { changedPaths: string[] }
}

function stageApp(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-eval-')))
  fs.cpSync(path.join(sharedRoot, 'ai'), path.join(root, '.ai'), { recursive: true })
  fs.cpSync(guidesRoot, path.join(root, '.ai', 'guides'), { recursive: true })
  fs.copyFileSync(path.join(sharedRoot, 'AGENTS.md.template'), path.join(root, 'AGENTS.md'))
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true })
  fs.copyFileSync(sourceEvaluator, path.join(root, 'scripts', 'evaluate-agent-harness.mjs'))
  fs.copyFileSync(sourceFixturePreparer, path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs'))
  return root
}

function stageWritableTarget(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-harness-writable-')))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.cpSync(sourceHarness, path.join(root, '.ai', 'harness'), { recursive: true })
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"harness-fixture"}\n')
  fs.writeFileSync(path.join(root, 'src', 'modules.ts'), 'export default []\n')
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(typescriptPackageRoot, path.join(root, 'node_modules', 'typescript'), process.platform === 'win32' ? 'junction' : 'dir')
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

function installFakeRunner(root: string, name: 'codex' | 'claude', source: string): string {
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin, { recursive: true })
  const fake = path.join(bin, name)
  fs.writeFileSync(fake, `#!/usr/bin/env node\n${source}`)
  fs.chmodSync(fake, 0o755)
  return bin
}

function storedResults(root: string): StoredResult[] {
  const directory = path.join(root, '.ai', 'harness', 'results')
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory).sort().map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), 'utf8')))
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
    const routingSchemaPath = path.join(root, '.ai', 'harness', 'routing-response.schema.json')
    const routingSchema = JSON.parse(fs.readFileSync(routingSchemaPath, 'utf8')) as {
      properties: { selectedRouter: { items: { enum: string[] } } }
    }
    routingSchema.properties.selectedRouter.items.enum = routingSchema.properties.selectedRouter.items.enum.filter((route) => route !== 'testing')
    fs.writeFileSync(routingSchemaPath, `${JSON.stringify(routingSchema, null, 2)}\n`)
    const seedsPath = path.join(root, '.ai', 'harness', 'fixtures', 'seeds.json')
    const seeds = JSON.parse(fs.readFileSync(seedsPath, 'utf8')) as { fixtures: Record<string, unknown> }
    delete seeds.fixtures['module-editable-entity']
    fs.writeFileSync(seedsPath, `${JSON.stringify(seeds, null, 2)}\n`)
    const validatorsPath = path.join(root, '.ai', 'harness', 'validators.json')
    const validators = JSON.parse(fs.readFileSync(validatorsPath, 'utf8')) as {
      validators: Record<string, { implementation: string }>
    }
    validators.validators['oracle.module.entity'].implementation = 'scan'
    fs.writeFileSync(validatorsPath, `${JSON.stringify(validators, null, 2)}\n`)
    const result = runEvaluator(root, ['--all'])
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /dangling related case OMH-999/)
    assert.match(result.stderr, /maxTotalContextBytes is invalid/)
    assert.match(result.stderr, /unsafe fixture setup/)
    assert.match(result.stderr, /routing response schema must expose every router ID in canonical order/)
    assert.match(result.stderr, /fixture seeds must cover every declared fixture exactly once/)
    assert.match(result.stderr, /uses forbidden token scanning/)
    assert.match(result.stderr, /oracle validator oracle\.module\.entity must use a trusted executable/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('fixture preparer safely seeds one writable case and refuses reuse', () => {
  const controller = stageApp()
  const target = stageWritableTarget()
  const script = path.join(controller, 'scripts', 'prepare-agent-harness-fixture.mjs')
  try {
    const withoutAcknowledgement = spawnSync(process.execPath, [script, '--case', 'OMH-009', '--target', target], {
      cwd: controller,
      encoding: 'utf8',
    })
    assert.equal(withoutAcknowledgement.status, 2)
    assert.match(withoutAcknowledgement.stderr, /acknowledge-writes/)

    const prepared = spawnSync(process.execPath, [script, '--case', 'OMH-009', '--target', target, '--acknowledge-writes'], {
      cwd: controller,
      encoding: 'utf8',
    })
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`)
    assert.equal(fs.existsSync(path.join(target, '.ai', 'harness', 'DISPOSABLE')), true)
    assert.equal(fs.existsSync(path.join(target, 'src', 'modules', 'library', 'index.ts')), true)

    const reused = spawnSync(process.execPath, [script, '--case', 'OMH-009', '--target', target, '--acknowledge-writes'], {
      cwd: controller,
      encoding: 'utf8',
    })
    assert.equal(reused.status, 2)
    assert.match(reused.stderr, /already prepared/)

    const nestedTarget = path.join(controller, 'nested-target')
    fs.mkdirSync(path.join(nestedTarget, 'src'), { recursive: true })
    fs.cpSync(sourceHarness, path.join(nestedTarget, '.ai', 'harness'), { recursive: true })
    fs.writeFileSync(path.join(nestedTarget, 'package.json'), '{"name":"nested"}\n')
    fs.writeFileSync(path.join(nestedTarget, 'src', 'modules.ts'), 'export default []\n')
    const nested = spawnSync(process.execPath, [script, '--case', 'OMH-009', '--target', nestedTarget, '--acknowledge-writes'], {
      cwd: controller,
      encoding: 'utf8',
    })
    assert.equal(nested.status, 2)
    assert.match(nested.stderr, /outside the controller app/)
  } finally {
    fs.rmSync(controller, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
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
if (!args.includes('--ephemeral') || !args.includes('--json') || !args.includes('--ignore-user-config') || args[args.indexOf('--disable') + 1] !== 'skill_search' || args[args.indexOf('--sandbox') + 1] !== 'read-only' || !args.includes('shell_environment_policy.inherit=none') || !process.env.CODEX_HOME?.includes('om-harness-result-')) process.exit(9)
const output = args[args.indexOf('-o') + 1]
fs.writeFileSync(output, JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md', '.ai/guides/testing-debugging.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
for (const command of [
  "/bin/zsh -lc \\\"sed -n '1,120p' AGENTS.md; sed -n '1,120p' .ai/guides/architecture.md\\\"",
  "rg -n '\\\\.ai/guides/(architecture|testing-debugging)\\\\.md$|SKILL.md' 2>/dev/null",
]) console.log(JSON.stringify({ type: 'item.completed', item: {
  type: 'command_execution', command, exit_code: 0, status: 'completed'
}}))
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
    const parsed = JSON.parse(stored) as {
      actualContext: { paths: string[] }
      declaredContext: { paths: string[] }
    }
    assert.deepEqual(parsed.actualContext.paths, ['.ai/guides/architecture.md', 'AGENTS.md'])
    assert.deepEqual(parsed.declaredContext.paths, ['.ai/guides/architecture.md', '.ai/guides/testing-debugging.md', 'AGENTS.md'])
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
if (args[args.indexOf('--permission-mode') + 1] !== 'plan' || args[args.indexOf('--tools') + 1] !== 'Read,Glob,Grep' || !args.includes('--no-session-persistence') || args[args.indexOf('--output-format') + 1] !== 'stream-json' || !args.includes('--verbose') || !args.includes('--json-schema')) process.exit(9)
console.log(JSON.stringify({ type: 'assistant', message: { content: [
  { type: 'tool_use', name: 'Glob', input: { pattern: '.ai/{guides,skills}/**/*.md' } },
  { type: 'tool_use', name: 'Read', input: { file_path: require('node:path').join(process.cwd(), 'AGENTS.md') } },
  { type: 'tool_use', name: 'Read', input: { file_path: require('node:path').join(process.cwd(), '.ai/guides/contracts.md') } },
  { type: 'tool_use', name: 'Read', input: { file_path: require('node:path').join(process.cwd(), '.ai/skills/om-data-model-design/SKILL.md') } }
] } }))
console.log(JSON.stringify({ type: 'result', structured_output: {
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

test('live routing rejects forbidden file and environment reads without inheriting unrelated environment values', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  fs.writeFileSync(path.join(root, '.env'), 'DO_NOT_READ=this-value\n')
  const secret = 'ghp_1234567890abcdefghij'
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
const output = args[args.indexOf('-o') + 1]
fs.writeFileSync(output, JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [process.env.UNRELATED_SECRET || 'om-environment-isolated'],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
for (const command of ["cat AGENTS.md .ai/guides/architecture.md", 'cat .env', 'printenv', 'echo $OPENAI_API_KEY']) {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command } }))
}
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      UNRELATED_SECRET: secret,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored)
    assert.ok(stored.selectedSkills.includes('om-environment-isolated'))
    assert.ok(stored.violations.includes('forbidden context read .env'))
    assert.ok(stored.violations.includes('forbidden environment inspection command'))
    assert.ok(stored.violations.includes('forbidden sensitive environment variable reference'))
    assert.ok(!stored.actualContext.paths.includes('.env'))
    assert.doesNotMatch(JSON.stringify(stored), new RegExp(secret))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('observed reads enforce context budgets without merging declared context', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const oversized = '.ai/guides/oversized-observed-context.md'
  fs.writeFileSync(path.join(root, oversized), 'x'.repeat(64 * 1024))
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
console.log(JSON.stringify({ type: 'item.completed', item: {
  type: 'command_execution', command: 'cat AGENTS.md .ai/guides/architecture.md .ai/guides/oversized-observed-context.md'
}}))
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.some((entry) => entry.startsWith('initial context byte budget exceeded:')))
    assert.ok(stored.actualContext.paths.includes(oversized))
    assert.ok(!stored.declaredContext.paths.includes(oversized))
    assert.ok(stored.actualContext.bytes > stored.declaredContext.bytes)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a lifecycle stream without a recognized tool event fails closed', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
console.log(JSON.stringify({ type: 'thread.started', thread_id: 'fake' }))
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.includes('runner trace unavailable; observed context cannot be verified'))
    assert.deepEqual(stored.actualContext.paths, [])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('recognized tool traces with no context reads fail closed', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'pwd' } }))
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.includes('runner trace contained no observed context reads'))
    assert.ok(stored.violations.includes('required context not observed AGENTS.md'))
    assert.ok(stored.violations.includes('required context not observed .ai/guides/architecture.md'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('out-of-root and broad app-root reads are rejected even when required context is observed', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
for (const command of ['cat AGENTS.md .ai/guides/architecture.md', 'cat /etc/passwd', 'find . -maxdepth 1']) {
  console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command } }))
}
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.some((entry) => entry.startsWith('unsafe out-of-root context read:')))
    assert.ok(stored.violations.includes('unsafe broad app-root context read'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('response fields are recursively redacted and long runner violations honor result limits', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const token = 'ghp_1234567890abcdefghij'
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
const home = process.env.HOME || '/private/fake-home'
const token = '${token}'
if (args[0] === '--version') { console.log('codex-fake ' + home + ' ' + token); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'],
  selectedSkills: ['om-sensitive-output'],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md', home + '/context-' + token],
  decisions: ['standalone-boundary', 'facts-first', process.env.UNRELATED_SECRET || 'environment-isolated'],
  violations: [home + '/violation-' + token + '-' + 'x'.repeat(2000)]
}))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat AGENTS.md .ai/guides/architecture.md' } }))
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001', '--model', `${os.homedir()}/model-${token}`], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
      UNRELATED_SECRET: token,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    const serialized = JSON.stringify(stored)
    assert.doesNotMatch(serialized, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.doesNotMatch(serialized, new RegExp(token))
    assert.match(serialized, /<redacted-path>/)
    assert.match(serialized, /<redacted-token>/)
    assert.ok(stored.decisions.includes('environment-isolated'))
    assert.ok(stored.violations.every((entry) => entry.length <= 300))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('long process errors are redacted, bounded, schema-valid, and still produce a failure artifact', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const token = 'ghp_1234567890abcdefghij'
  const bin = installFakeRunner(root, 'codex', `
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat AGENTS.md' } }))
console.error(((process.env.HOME || '/private/fake-home') + ' ${token} ' + 'x'.repeat(200)).repeat(30))
process.exit(7)
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    const serialized = JSON.stringify(stored)
    assert.doesNotMatch(serialized, new RegExp(token))
    assert.doesNotMatch(serialized, new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    assert.ok((stored.sanitizedError?.length ?? 0) <= 4096)
    assert.ok(stored.violations.every((entry) => entry.length <= 300))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('result schema validation happens before an artifact is written', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const schemaPath = path.join(root, '.ai', 'harness', 'result.schema.json')
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8')) as {
    properties: { runnerVersion: { maxLength: number } }
  }
  schema.properties.runnerVersion.maxLength = 1
  fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`)
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['architecture'], selectedSkills: [],
  selectedContext: ['AGENTS.md', '.ai/guides/architecture.md'],
  decisions: ['standalone-boundary', 'facts-first'], violations: []
}))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat AGENTS.md' } }))
`)
  try {
    const run = runEvaluator(root, ['--runner', 'codex', '--case', 'OMH-001'], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 2, `${run.stdout}\n${run.stderr}`)
    assert.match(run.stderr, /result schema validation failed/)
    assert.deepEqual(storedResults(root), [])
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

test('writable mode executes trusted oracles only from the controller harness', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const target = stageWritableTarget()
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['module-data'], selectedSkills: ['om-module-scaffold'],
  selectedContext: ['AGENTS.md', '.ai/guides/contracts.md', '.ai/skills/om-module-scaffold/SKILL.md'],
  decisions: ['crud-factory', 'scoped-response', 'openapi-indexer'], violations: []
}))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat AGENTS.md .ai/guides/contracts.md .ai/skills/om-module-scaffold/SKILL.md' } }))
`)
  try {
    const prepared = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs'),
      '--case', 'OMH-011', '--target', target, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`)
    fs.writeFileSync(path.join(target, '.ai', 'harness', 'writable-ast-oracles.mjs'), `
import fs from 'node:fs'
fs.writeFileSync('TARGET_ORACLE_EXECUTED', 'unsafe')
console.log(JSON.stringify({ passed: process.argv.includes('after'), failures: process.argv.includes('after') ? [] : ['before'], checks: [] }))
`)
    const run = runEvaluator(root, [
      '--runner', 'codex', '--case', 'OMH-011', '--writable-root', target, '--acknowledge-writes',
    ], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    assert.equal(fs.existsSync(path.join(target, 'TARGET_ORACLE_EXECUTED')), false)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.some((entry) => entry.includes('writable-ast-oracles.mjs')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('writable snapshots detect protected ignored-root and arbitrary root writes', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const target = stageWritableTarget()
  const bin = installFakeRunner(root, 'codex', `
const fs = require('node:fs')
const path = require('node:path')
const args = process.argv.slice(2)
if (args[0] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
for (const relative of ['.git/tampered', 'node_modules/tampered.txt', 'UNEXPECTED.txt']) {
  fs.mkdirSync(path.dirname(relative), { recursive: true })
  fs.writeFileSync(relative, 'tampered')
}
fs.writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify({
  selectedRouter: ['module-data'], selectedSkills: ['om-data-model-design'],
  selectedContext: ['AGENTS.md', '.ai/guides/contracts.md', '.ai/skills/om-data-model-design/SKILL.md'],
  decisions: ['tenant-scope', 'optimistic-lock', 'migration-snapshot'], violations: []
}))
console.log(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'cat src/modules/library/data/entities.ts' } }))
`)
  try {
    const prepared = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs'),
      '--case', 'OMH-009', '--target', target, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`)
    const run = runEvaluator(root, [
      '--runner', 'codex', '--case', 'OMH-009', '--writable-root', target, '--acknowledge-writes',
    ], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(run.status, 1, `${run.stdout}\n${run.stderr}`)
    const [stored] = storedResults(root)
    assert.ok(stored.violations.some((entry) => entry.includes('writes to protected roots: .git, node_modules')))
    assert.ok(stored.violations.some((entry) => entry.includes('writes outside allowlist: UNEXPECTED.txt')))
    assert.ok(stored.writable?.changedPaths.includes('.git'))
    assert.ok(stored.writable?.changedPaths.includes('node_modules'))
    assert.ok(stored.writable?.changedPaths.includes('UNEXPECTED.txt'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})

test('writable mode rejects a disposable marker prepared for another case', { skip: process.platform === 'win32' }, () => {
  const root = stageApp()
  const target = stageWritableTarget()
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const fake = path.join(bin, 'codex')
  fs.writeFileSync(fake, `#!/usr/bin/env node
if (process.argv[2] === '--version') { console.log('codex-fake 1.0'); process.exit(0) }
process.exit(9)
`)
  fs.chmodSync(fake, 0o755)
  try {
    const prepared = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'prepare-agent-harness-fixture.mjs'),
      '--case', 'OMH-009', '--target', target, '--acknowledge-writes',
    ], { cwd: root, encoding: 'utf8' })
    assert.equal(prepared.status, 0, `${prepared.stdout}\n${prepared.stderr}`)
    const result = runEvaluator(root, [
      '--runner', 'codex', '--case', 'OMH-014', '--writable-root', target, '--acknowledge-writes',
    ], {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}`,
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /disposable marker does not match the selected case fixture/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
    fs.rmSync(target, { recursive: true, force: true })
  }
})
