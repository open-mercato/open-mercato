import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { WRITABLE_CASE_IDS } from '../../agentic/shared/ai/harness/writable-ast-oracles.mjs'

const require = createRequire(import.meta.url)
const oracle = fileURLToPath(new URL('../../agentic/shared/ai/harness/writable-ast-oracles.mjs', import.meta.url))
const targetTypeScript = path.dirname(require.resolve('typescript/package.json'))

const EXPECTED_WRITABLE_CASE_IDS = [
  'OMH-009', 'OMH-011', 'OMH-012', 'OMH-014', 'OMH-026', 'OMH-027', 'OMH-029', 'OMH-031',
  'OMH-042', 'OMH-045', 'OMH-049', 'OMH-054', 'OMH-057', 'OMH-060', 'OMH-061', 'OMH-070',
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

function runOracle(root: string, phase: 'before' | 'after', env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(process.execPath, [oracle, '--root', root, '--case', 'OMH-011', '--phase', phase, '--json'], {
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
fs.writeFileSync(require('node:path').join(process.cwd(), 'typecheck-invocation.txt'), process.argv.slice(2).join(' '))
process.exit(Number(process.env.ORACLE_TYPECHECK_STATUS || 0))
`)
    fs.chmodSync(executable, 0o755)
  }
  return bin
}

test('the trusted writable AST oracle owns exactly the fixed 16-case matrix', () => {
  assert.deepEqual(WRITABLE_CASE_IDS, EXPECTED_WRITABLE_CASE_IDS)
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
declare function makeCrudRoute(options: { metadata: unknown; openApi: unknown; indexer: unknown }): unknown
export const route = makeCrudRoute({ metadata: {}, openApi: {}, indexer: {} })
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

test('after phase invokes only the fixed target yarn typecheck gate and reports its status', () => {
  const root = stageTarget('src/modules/library/api/books/route.ts', `
declare function makeCrudRoute(options: { metadata: unknown; openApi: unknown; indexer: unknown }): unknown
export const route = makeCrudRoute({ metadata: {}, openApi: {}, indexer: {} })
`)
  const bin = installFakeYarn(root)
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }
  try {
    const passing = runOracle(root, 'after', { ...env, ORACLE_TYPECHECK_STATUS: '0' })
    assert.equal(passing.status, 0, `${passing.stdout}\n${passing.stderr}`)
    assert.equal(passing.parsed.checks.find((entry) => entry.id === 'target.typecheck')?.passed, true)
    assert.equal(fs.readFileSync(path.join(root, 'typecheck-invocation.txt'), 'utf8'), 'typecheck')

    const failing = runOracle(root, 'after', { ...env, ORACLE_TYPECHECK_STATUS: '1' })
    assert.equal(failing.status, 1, `${failing.stdout}\n${failing.stderr}`)
    assert.equal(failing.parsed.checks.find((entry) => entry.id === 'target.typecheck')?.passed, false)
    assert.match(failing.parsed.failures.join('\n'), /target\.typecheck/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
