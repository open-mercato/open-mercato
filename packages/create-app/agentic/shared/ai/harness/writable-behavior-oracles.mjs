#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const EXIT_PASS = 0
const EXIT_FAILURE = 1
const EXIT_INVALID = 2
const MAX_SOURCE_BYTES = 256 * 1024
const WORKER_TIMEOUT_MS = 3_000

const CASES = {
  'OMH-045': { file: 'src/modules/external_sync/lib/client.ts' },
  'OMH-054': { file: 'src/modules/automation/workflows/call-api.ts' },
  'OMH-057': { file: 'src/modules/harness_fixture/api/scope/route.ts' },
  'OMH-060': { file: 'src/modules/harness_fixture/commands/update-record.ts' },
  'OMH-061': {
    file: 'src/modules/harness_fixture/backend/edit/page.tsx',
    allowedCompiledImport: '@open-mercato/ui/backend/CrudForm',
  },
  'OMH-070': { file: 'src/modules/harness_fixture/workers/sync.ts' },
}

const PROBES = {
  'OMH-045': `
    const fetchPage = module.exports.fetchPage
    if (typeof fetchPage !== 'function') throw new Error('required export fetchPage is missing')
    const checks = []
    const state = { cursor: 'cursor-current' }
    const urls = []
    let attempt = 0
    let page
    let retryError
    const effects = {
      maxAttempts: 2,
      async fetch(url) {
        urls.push(url)
        attempt += 1
        if (attempt === 1) return { ok: false, status: 503, async json() { return {} } }
        return { ok: true, status: 200, async json() { return { items: ['record'], nextCursor: 'cursor-next' } } }
      },
    }
    try { page = await fetchPage('https://provider.test/records', state, effects) } catch (error) { retryError = error }
    checks.push({ id: 'retries-transient-response', passed: !retryError && attempt === 2 })
    checks.push({ id: 'retries-same-cursor', passed: urls.length === 2 && urls.every((url) => url.endsWith('cursor=cursor-current')) })
    checks.push({ id: 'commits-cursor-after-success', passed: state.cursor === 'cursor-next' && page?.nextCursor === 'cursor-next' })

    const failedState = { cursor: 'cursor-stable' }
    let failedAttempts = 0
    let terminalRejected = false
    try {
      await fetchPage('https://provider.test/records', failedState, {
        maxAttempts: 2,
        async fetch() {
          failedAttempts += 1
          return { ok: false, status: 503, async json() { return {} } }
        },
      })
    } catch { terminalRejected = true }
    checks.push({ id: 'bounds-retries', passed: terminalRejected && failedAttempts === 2 })
    checks.push({ id: 'preserves-cursor-after-terminal-failure', passed: failedState.cursor === 'cursor-stable' })

    let privateFetchCalls = 0
    let privateEndpointRejected = false
    try {
      await fetchPage('http://127.0.0.1/admin', { cursor: 'cursor-private' }, {
        maxAttempts: 2,
        async fetch() {
          privateFetchCalls += 1
          return { ok: true, status: 200, async json() { return { items: [] } } }
        },
      })
    } catch { privateEndpointRejected = true }
    checks.push({ id: 'rejects-private-endpoint-before-fetch', passed: privateEndpointRejected && privateFetchCalls === 0 })
    return { checks }
  `,
  'OMH-054': `
    const callApiActivity = module.exports.callApiActivity
    if (typeof callApiActivity !== 'function') throw new Error('required export callApiActivity is missing')
    const checks = []
    const durable = new Set()
    const posts = []
    const events = []
    let transactionState = null
    const effects = {
      async reserveIdempotency(key) {
        events.push('reserve:' + key)
        if (transactionState) transactionState.add(key)
        else durable.add(key)
        return key
      },
      async transaction(work) {
        events.push('transaction:start')
        const staged = new Set()
        transactionState = staged
        try {
          const result = await work()
          for (const key of staged) durable.add(key)
          events.push('transaction:commit')
          return result
        } catch (error) {
          events.push('transaction:rollback')
          throw error
        } finally {
          transactionState = null
        }
      },
      async post(url, options) {
        posts.push({ url, key: options?.idempotencyKey })
        if (posts.length === 1) throw new Error('injected post failure')
        return { ok: true }
      },
    }
    const input = { url: 'https://provider.test/action', idempotencyKey: 'activity-key' }
    let firstRejected = false
    try { await callApiActivity(input, effects) } catch { firstRejected = true }
    checks.push({ id: 'injected-failure-rolls-back-transaction', passed: firstRejected && events.includes('transaction:rollback') })
    checks.push({ id: 'idempotency-survives-rollback', passed: durable.has('activity-key') })
    let retryError
    try { await callApiActivity(input, effects) } catch (error) { retryError = error }
    checks.push({ id: 'retry-reuses-idempotency-key', passed: !retryError && posts.length === 2 && posts.every((post) => post.key === 'activity-key') })
    checks.push({ id: 'reservation-precedes-transaction', passed: events[0] === 'reserve:activity-key' && events[1] === 'transaction:start' })
    return { checks }
  `,
  'OMH-057': `
    const listRecords = module.exports.listRecords
    if (typeof listRecords !== 'function') throw new Error('required export listRecords is missing')
    const checks = []
    const calls = []
    const store = { async find(filter) { calls.push(filter); return ['record'] } }
    let missingTenantRejected = false
    try { await listRecords({ organizationId: 'organization-1' }, store) } catch { missingTenantRejected = true }
    let missingOrganizationRejected = false
    try { await listRecords({ tenantId: 'tenant-1' }, store) } catch { missingOrganizationRejected = true }
    checks.push({ id: 'rejects-missing-tenant', passed: missingTenantRejected })
    checks.push({ id: 'rejects-missing-organization', passed: missingOrganizationRejected })
    checks.push({ id: 'does-not-query-with-missing-scope', passed: calls.length === 0 })
    let validResult
    let validError
    try { validResult = await listRecords({ tenantId: 'tenant-1', organizationId: 'organization-1' }, store) } catch (error) { validError = error }
    const filter = calls[0]
    checks.push({
      id: 'queries-with-complete-scope',
      passed: !validError && Array.isArray(validResult) && calls.length === 1
        && filter?.tenant_id === 'tenant-1' && filter?.organization_id === 'organization-1',
    })
    return { checks }
  `,
  'OMH-060': `
    const updateRecord = module.exports.updateRecord
    if (typeof updateRecord !== 'function') throw new Error('required export updateRecord is missing')
    const checks = []
    function makeStore() {
      const committed = []
      const store = {
        committed,
        async persist(value) { committed.push({ ...value }) },
        async flush() {},
        async transaction(work) {
          const pending = []
          const transactionalStore = {
            async persist(value) { pending.push({ ...value }) },
            async flush() {},
          }
          const result = await work(transactionalStore)
          committed.push(...pending)
          return result
        },
      }
      return store
    }
    const failedStore = makeStore()
    let injectedFailureObserved = false
    try { await updateRecord(failedStore, true) } catch { injectedFailureObserved = true }
    checks.push({ id: 'propagates-injected-failure', passed: injectedFailureObserved })
    checks.push({ id: 'rolls-back-all-phases', passed: failedStore.committed.length === 0 })
    const successStore = makeStore()
    let successError
    try { await updateRecord(successStore, false) } catch (error) { successError = error }
    checks.push({
      id: 'commits-complete-write-on-success',
      passed: !successError && successStore.committed.length === 2
        && successStore.committed[0]?.phase === 1 && successStore.committed[1]?.phase === 2,
    })
    return { checks }
  `,
  'OMH-061': `
    const toInitialValues = module.exports.toInitialValues
    const toUpdatePayload = module.exports.toUpdatePayload
    if (typeof toInitialValues !== 'function' || typeof toUpdatePayload !== 'function') {
      throw new Error('required nullable round-trip exports are missing')
    }
    const checks = []
    const initialNull = toInitialValues({ note: null })
    checks.push({ id: 'loads-explicit-null', passed: initialNull?.note === null })
    const cleared = toUpdatePayload({ note: '' })
    checks.push({ id: 'serializes-clear-as-null', passed: Object.prototype.hasOwnProperty.call(cleared ?? {}, 'note') && cleared.note === null })
    const reloaded = toInitialValues(cleared)
    checks.push({ id: 'reload-preserves-null', passed: reloaded?.note === null })
    const text = 'kept value'
    const nonNull = toUpdatePayload(toInitialValues({ note: text }))
    checks.push({ id: 'round-trips-non-null-value', passed: nonNull?.note === text })
    return { checks }
  `,
  'OMH-070': `
    const syncPage = module.exports.syncPage
    if (typeof syncPage !== 'function') throw new Error('required export syncPage is missing')
    const checks = []
    const state = { cursor: 'cursor-current' }
    const received = []
    let attempt = 0
    let page
    let retryError
    const provider = {
      maxAttempts: 2,
      nextCursor: 'cursor-next',
      async fetchPage(cursor) {
        received.push(cursor)
        attempt += 1
        if (attempt === 1) throw new Error('transient provider failure')
        return { items: ['record'], nextCursor: 'cursor-next' }
      },
    }
    try { page = await syncPage(state, provider) } catch (error) { retryError = error }
    checks.push({ id: 'retries-transient-page', passed: !retryError && attempt === 2 })
    checks.push({ id: 'retries-current-cursor', passed: received.length === 2 && received.every((cursor) => cursor === 'cursor-current') })
    checks.push({ id: 'advances-after-success', passed: state.cursor === 'cursor-next' && page?.nextCursor === 'cursor-next' })

    const failedState = { cursor: 'cursor-stable' }
    let failedAttempts = 0
    let terminalRejected = false
    try {
      await syncPage(failedState, {
        maxAttempts: 2,
        nextCursor: 'cursor-never',
        async fetchPage(cursor) {
          if (cursor !== 'cursor-stable') throw new Error('cursor advanced before success')
          failedAttempts += 1
          throw new Error('transient provider failure')
        },
      })
    } catch { terminalRejected = true }
    checks.push({ id: 'bounds-page-retries', passed: terminalRejected && failedAttempts === 2 })
    checks.push({ id: 'preserves-cursor-after-terminal-failure', passed: failedState.cursor === 'cursor-stable' })
    return { checks }
  `,
}

function usage() {
  return `Usage: node .ai/harness/writable-behavior-oracles.mjs --root <absolute-app-path> --case <OMH-NNN> --phase <before|after> [--json]`
}

function parseArgs(argv) {
  const options = { root: undefined, caseId: undefined, phase: undefined, json: false, internalCase: undefined }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const takeValue = () => {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      index += 1
      return value
    }
    if (arg === '--root') options.root = takeValue()
    else if (arg === '--case') options.caseId = takeValue()
    else if (arg === '--phase') options.phase = takeValue()
    else if (arg === '--json') options.json = true
    else if (arg === '--internal-case') options.internalCase = takeValue()
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

function safeMessage(error, root) {
  let message = String(error?.message ?? error ?? 'unknown error')
  for (const sensitive of [root, process.env.HOME, os.homedir()].filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(sensitive).join('<redacted-path>')
  }
  return message
    .replace(/\b(?:sk|ghp|github_pat|xox[baprs])[-_A-Za-z0-9]{8,}\b/g, '<redacted-token>')
    .slice(0, 500)
}

function readTargetSource(root, caseRecord) {
  const candidate = path.resolve(root, caseRecord.file)
  if (!isPathInside(root, candidate)) throw new Error('oracle target escapes the app root')
  const realRoot = fs.realpathSync(root)
  const realCandidate = fs.realpathSync(candidate)
  if (!isPathInside(realRoot, realCandidate)) throw new Error('oracle target resolves outside the app root')
  const stat = fs.statSync(realCandidate)
  if (!stat.isFile()) throw new Error(`oracle target is not a file: ${caseRecord.file}`)
  if (stat.size > MAX_SOURCE_BYTES) throw new Error(`oracle target exceeds ${MAX_SOURCE_BYTES} bytes`)
  return fs.readFileSync(realCandidate, 'utf8')
}

function loadTargetTypeScript(root) {
  const targetRequire = createRequire(path.join(root, 'package.json'))
  let resolved
  try { resolved = targetRequire.resolve('typescript') } catch { throw new Error('target app TypeScript compiler is unavailable') }
  return targetRequire(resolved)
}

function transpileTarget(root, caseRecord, source) {
  const ts = loadTargetTypeScript(root)
  const result = ts.transpileModule(source, {
    fileName: caseRecord.file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  })
  const diagnostics = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length) {
    const codes = diagnostics.slice(0, 8).map((diagnostic) => `TS${diagnostic.code}`).join(', ')
    throw new Error(`target TypeScript compilation failed (${codes})`)
  }
  let output = result.outputText
  if (caseRecord.allowedCompiledImport) {
    const escaped = caseRecord.allowedCompiledImport.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const importExpression = new RegExp(`require\\(["']${escaped}["']\\)`, 'g')
    output = output.replace(importExpression, '({ CrudForm: function CrudForm() {} })')
  }
  if (/\brequire\s*\(/.test(output)) throw new Error('behavior-oracle target must not execute imports')
  return output
}

function executeWorker(caseId, compiledSource) {
  const child = spawnSync(process.execPath, [
    '--permission', path.resolve(process.argv[1]), '--internal-case', caseId,
  ], {
    input: compiledSource,
    encoding: 'utf8',
    timeout: WORKER_TIMEOUT_MS,
    maxBuffer: 512 * 1024,
    env: { NO_COLOR: '1' },
  })
  if (child.error?.code === 'ETIMEDOUT' || child.signal) throw new Error('behavior probe timed out')
  if (child.error) throw child.error
  if (child.status !== 0) throw new Error(child.stderr.trim() || 'behavior probe worker failed')
  let parsed
  try { parsed = JSON.parse(child.stdout) } catch { throw new Error('behavior probe worker returned invalid JSON') }
  if (!Array.isArray(parsed?.checks) || parsed.checks.some((check) => typeof check?.id !== 'string' || typeof check?.passed !== 'boolean')) {
    throw new Error('behavior probe worker returned an invalid result')
  }
  return parsed
}

async function internalRun(caseId) {
  const probe = PROBES[caseId]
  if (!probe) throw new Error(`unsupported behavior-oracle case: ${caseId}`)
  const chunks = []
  let size = 0
  for await (const chunk of process.stdin) {
    size += chunk.length
    if (size > MAX_SOURCE_BYTES * 4) throw new Error('compiled target exceeds worker input limit')
    chunks.push(chunk)
  }
  const compiledSource = Buffer.concat(chunks).toString('utf8')
  const context = vm.createContext(Object.create(null), {
    name: `writable-behavior-oracle-${caseId}`,
    codeGeneration: { strings: false, wasm: false },
  })
  new vm.Script(`
    'use strict';
    class OracleURLSearchParams {
      #entries = []
      constructor(query = '') {
        for (const pair of String(query).replace(/^\\?/, '').split('&')) {
          if (!pair) continue
          const separator = pair.indexOf('=')
          const key = separator < 0 ? pair : pair.slice(0, separator)
          const value = separator < 0 ? '' : pair.slice(separator + 1)
          this.#entries.push([decodeURIComponent(key), decodeURIComponent(value)])
        }
      }
      get(key) { return this.#entries.find(([name]) => name === String(key))?.[1] ?? null }
      set(key, value) {
        const name = String(key)
        this.#entries = this.#entries.filter(([candidate]) => candidate !== name)
        this.#entries.push([name, String(value)])
      }
      toString() { return this.#entries.map(([key, value]) => encodeURIComponent(key) + '=' + encodeURIComponent(value)).join('&') }
    }
    class OracleURL {
      constructor(input) {
        const match = /^(https?):\\/\\/([^/?#]+)([^?#]*)(?:\\?([^#]*))?(?:#(.*))?$/.exec(String(input))
        if (!match) throw new TypeError('invalid absolute URL')
        this.protocol = match[1] + ':'
        const authority = match[2]
        const portIndex = authority.lastIndexOf(':')
        this.hostname = portIndex > -1 ? authority.slice(0, portIndex) : authority
        this.port = portIndex > -1 ? authority.slice(portIndex + 1) : ''
        this.pathname = match[3] || '/'
        this.hash = match[5] ? '#' + match[5] : ''
        this.searchParams = new OracleURLSearchParams(match[4] || '')
      }
      toString() {
        const query = this.searchParams.toString()
        return this.protocol + '//' + this.hostname + (this.port ? ':' + this.port : '') + this.pathname + (query ? '?' + query : '') + this.hash
      }
      get href() { return this.toString() }
    }
    globalThis.URL = OracleURL
    globalThis.URLSearchParams = OracleURLSearchParams
    globalThis.module = { exports: Object.create(null) }
    globalThis.exports = globalThis.module.exports
  `).runInContext(context, { timeout: 250 })
  new vm.Script(`'use strict';\n${compiledSource}`, { filename: CASES[caseId].file }).runInContext(context, { timeout: 1_000 })
  new vm.Script(`'use strict'; globalThis.__oracleResult = (async () => {${probe}})();`).runInContext(context, { timeout: 1_000 })
  const serialized = await new vm.Script(`(async () => JSON.stringify(await globalThis.__oracleResult))()`).runInContext(context, { timeout: 1_000 })
  process.stdout.write(`${serialized}\n`)
}

function emit(result, json) {
  if (json) process.stdout.write(`${JSON.stringify(result)}\n`)
  else {
    const marker = result.passed ? 'PASS' : 'FAIL'
    process.stdout.write(`${marker}: ${result.failures.join('; ') || 'all behavior checks passed'}\n`)
  }
}

async function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    console.error(error.message)
    console.error(usage())
    return EXIT_INVALID
  }
  if (options.internalCase) {
    try { await internalRun(options.internalCase); return EXIT_PASS } catch (error) {
      console.error(safeMessage(error))
      return EXIT_INVALID
    }
  }
  if (options.help) { console.log(usage()); return EXIT_PASS }
  const root = options.root ? path.resolve(options.root) : undefined
  try {
    if (!options.root || !path.isAbsolute(options.root)) throw new Error('--root must be an absolute path')
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error('--root must identify an existing directory')
    if (!CASES[options.caseId]) throw new Error(`--case must be one of: ${Object.keys(CASES).join(', ')}`)
    if (!['before', 'after'].includes(options.phase)) throw new Error('--phase must be before or after')
    const caseRecord = CASES[options.caseId]
    const source = readTargetSource(root, caseRecord)
    const compiled = transpileTarget(root, caseRecord, source)
    const probe = executeWorker(options.caseId, compiled)
    const failures = probe.checks.filter((check) => !check.passed).map((check) => `${check.id}: behavior requirement was not met`)
    const result = { passed: failures.length === 0, failures, checks: probe.checks }
    emit(result, options.json)
    return result.passed ? EXIT_PASS : EXIT_FAILURE
  } catch (error) {
    emit({ passed: false, failures: [safeMessage(error, root)], checks: [] }, options.json)
    return EXIT_INVALID
  }
}

process.exitCode = await main()
