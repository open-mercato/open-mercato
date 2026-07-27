import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { hasExactString, WRITABLE_CASE_IDS } from '../../agentic/shared/ai/harness/writable-ast-oracles.mjs'

const require = createRequire(import.meta.url)
const oracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-ast-oracles.mjs', import.meta.url))
// The standalone template currently installs TypeScript 6. Keep oracle fixtures
// on that public compiler API while the monorepo itself exercises TypeScript 7.
const targetTypeScript = path.dirname(require.resolve('typescript-standalone/package.json'))
const targetSandboxAvailable = process.platform === 'darwin'
  || (process.platform === 'linux' && spawnSync('bwrap', ['--version'], { encoding: 'utf8' }).status === 0)

const EXPECTED_WRITABLE_CASE_IDS = [
  'OMH-009', 'OMH-011', 'OMH-012', 'OMH-014', 'OMH-026', 'OMH-027', 'OMH-029', 'OMH-031',
  'OMH-042', 'OMH-045', 'OMH-049', 'OMH-054', 'OMH-057', 'OMH-060', 'OMH-061', 'OMH-070',
  'OMH-093', 'OMH-105', 'OMH-107', 'OMH-115', 'OMH-122', 'OMH-128', 'OMH-130', 'OMH-133',
  'OMH-137', 'OMH-140', 'OMH-144', 'OMH-146', 'OMH-149', 'OMH-150', 'OMH-151', 'OMH-153',
  'OMH-156', 'OMH-163', 'OMH-164', 'OMH-165', 'OMH-171', 'OMH-172', 'OMH-181', 'OMH-185',
]

type OracleResult = {
  passed: boolean
  failures: string[]
  checks: Array<{ id: string; passed: boolean; requirement: string }>
}

function stageTarget(relativeFile: string, source: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'om-writable-ast-')))
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  fs.symlinkSync(targetTypeScript, path.join(root, 'node_modules', 'typescript'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.writeFileSync(path.join(root, 'package.json'), '{"name":"writable-ast-fixture","private":true}\n')
  const destination = path.join(root, relativeFile)
  fs.mkdirSync(path.dirname(destination), { recursive: true })
  fs.writeFileSync(destination, source)
  return root
}

function runOracle(root: string, phase: 'before' | 'after', env: NodeJS.ProcessEnv = process.env, caseId = 'OMH-011') {
  const result = spawnSync(process.execPath, [oracle, '--root', root, '--case', caseId, '--phase', phase, '--json'], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10_000,
  })
  return { ...result, parsed: JSON.parse(result.stdout) as OracleResult }
}

function installFakeYarn(root: string): string {
  const bin = path.join(root, 'fake-bin')
  fs.mkdirSync(bin)
  const executable = path.join(bin, process.platform === 'win32' ? 'yarn.cmd' : 'yarn')
  if (process.platform === 'win32') {
    fs.writeFileSync(executable, '@echo off\r\necho %* > "%CD%\\typecheck-invocation.txt"\r\nexit /b %ORACLE_TYPECHECK_STATUS%\r\n')
  } else {
    fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
fs.writeFileSync(require('node:path').join(process.cwd(), 'typecheck-invocation.txt'), process.argv.slice(2).join(' '))
const statusFile = path.join(process.cwd(), '.oracle-typecheck-status')
process.exit(fs.existsSync(statusFile) ? Number(fs.readFileSync(statusFile, 'utf8')) : 0)
`)
    fs.chmodSync(executable, 0o755)
  }
  return bin
}

test('the trusted writable AST oracle owns exactly the fixed writable-case matrix', () => {
  assert.deepEqual(WRITABLE_CASE_IDS, EXPECTED_WRITABLE_CASE_IDS)
})

test('the complete module oracle enforces connected customers-level CRUD', () => {
  const source = fs.readFileSync(oracle, 'utf8')
  for (const checkId of [
    'module.crud-actions',
    'module.openapi',
    'module.list-query',
    'module.table',
    'module.form',
  ]) assert.match(source, new RegExp(`check\\('${checkId.replace('.', '\\.')}'`))
  for (const contract of [
    'library.books.create',
    'library.books.update',
    'library.books.delete',
    'searchValue',
    'onSearchChange',
    'buildFilters',
    'createCrud',
    'updateCrud',
    'deleteCrud',
  ]) assert.ok(source.includes(contract), `missing complete-module oracle contract ${contract}`)
  assert.match(source, /value\.endsWith\('\.edit'\)/)
  assert.match(source, /value\.endsWith\('\.delete'\)/)
})

test('the complete module oracle accepts canonical enabledModules.push activation', () => {
  const root = stageTarget('src/modules.ts', `
export const enabledModules = [
  { id: 'directory', from: '@open-mercato/core' },
  { id: 'example', from: '@app' },
]
enabledModules.push({ id: 'library', from: '@app' })
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.activation')?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the entity oracle accepts camelCase properties mapped to canonical database columns', () => {
  const root = stageTarget('src/modules/library/data/entities.ts', `
import { Entity, Property } from '@mikro-orm/core'

@Entity()
export class LibraryBook {
  @Property({ fieldName: 'tenant_id' })
  tenantId!: string

  @Property({ name: 'organization_id' })
  organizationId!: string

  @Property({ fieldName: 'updated_at' })
  updatedAt!: Date
}
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-009')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'entity.declaration')?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle rejects activation that hides baseline entries in computed spreads', () => {
  const root = stageTarget('src/modules.ts', `
export const enabledModules = [
  ...['directory'].map((id) => ({ id, from: '@open-mercato/core' })),
  { id: 'example', from: '@app' },
  { id: 'library', from: '@app' },
]
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.activation')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('exact string graders reject literals that only share the expected prefix', () => {
  const facts = { strings: new Set(['smtpHealthServiceDecoy', 'smtp_email.view.extra']) }
  assert.equal(hasExactString(facts, 'smtpHealthService'), false)
  assert.equal(hasExactString(facts, 'smtp_email.view'), false)
  facts.strings.add('smtpHealthService')
  assert.equal(hasExactString(facts, 'smtpHealthService'), true)
})

test('imports and comments cannot satisfy a concrete call/options oracle', () => {
  const root = stageTarget('src/modules/library/api/books/route.ts', `
import { makeCrudRoute, metadata, openApi, indexer } from 'decoy'
// makeCrudRoute({ metadata, openApi, indexer })
export const route = { status: 'not-implemented' }
`)
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.status, 1, result.stderr)
    assert.equal(result.parsed.passed, false)
    assert.match(result.parsed.failures.join('\n'), /crud\.route/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('a concrete makeCrudRoute call with the required option keys passes the AST oracle', () => {
  const root = stageTarget('src/modules/library/api/books/route.ts', `
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
export const route = makeCrudRoute({ metadata: {}, orm: {}, list: {}, actions: {}, indexer: {} })
export const openApi = { methods: {} }
`)
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    assert.equal(result.parsed.passed, true)
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'crud.route')?.passed, true)
    assert.equal(result.parsed.checks.some((entry) => entry.id === 'target.typecheck'), false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('after phase invokes only the fixed contained target yarn typecheck gate and reports its status', { skip: !targetSandboxAvailable }, () => {
  const root = stageTarget('src/modules/library/api/books/route.ts', `
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
export const route = makeCrudRoute({ metadata: {}, orm: {}, list: {}, actions: {}, indexer: {} })
export const openApi = { methods: {} }
`)
  const bin = installFakeYarn(root)
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
  try {
    fs.writeFileSync(path.join(root, '.oracle-typecheck-status'), '0')
    const passing = runOracle(root, 'after', env)
    assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`)
    assert.equal(passing.parsed.checks.find((entry) => entry.id === 'target.typecheck')?.passed, true)
    const invocation = fs.readFileSync(path.join(root, 'typecheck-invocation.txt'), 'utf8')
    assert.match(invocation, /^typecheck --tsBuildInfoFile \/.*\/tsconfig\.tsbuildinfo$/)
    assert.equal(fs.existsSync(path.join(root, 'tsconfig.tsbuildinfo')), false)

    fs.writeFileSync(path.join(root, '.oracle-typecheck-status'), '1')
    const failing = runOracle(root, 'after', env)
    assert.equal(failing.status, 1, `${failing.stdout}\n${failing.stderr}`)
    assert.equal(failing.parsed.checks.find((entry) => entry.id === 'target.typecheck')?.passed, false)
    assert.match(failing.parsed.failures.join('\n'), /target\.typecheck/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
