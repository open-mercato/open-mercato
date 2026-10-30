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
  'OMH-188', 'OMH-189', 'OMH-190', 'OMH-191', 'OMH-192', 'OMH-193',
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

function stageLocaleTarget(source: string, catalogs: Record<string, unknown | string>): string {
  const root = stageTarget('src/modules/library/backend/books/page.tsx', source)
  const localeDirectory = path.join(root, 'src/modules/library/i18n')
  fs.mkdirSync(localeDirectory, { recursive: true })
  for (const [locale, catalog] of Object.entries(catalogs)) {
    fs.writeFileSync(path.join(localeDirectory, `${locale}.json`), typeof catalog === 'string' ? catalog : `${JSON.stringify(catalog)}\n`)
  }
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

function writeModuleFacts(root: string, facts: Record<string, unknown>, version: 1 | 2 = 1): void {
  const factsFile = path.join(root, '.ai', 'guides', version === 2 ? 'module-facts.v2.json' : 'module-facts.json')
  fs.mkdirSync(path.dirname(factsFile), { recursive: true })
  fs.writeFileSync(factsFile, `${JSON.stringify(facts, null, 2)}\n`)
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
    'module.locale-catalog',
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

test('the complete module oracle rejects a missing literal module locale key after the legacy localization signal passes', () => {
  const root = stageTarget('src/modules/library/backend/books/page.tsx', `
export function useT() { return (key: string) => key }
export const metadata = { pageTitleKey: 'library.books.title' }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`)
  fs.mkdirSync(path.join(root, 'src/modules/library/i18n'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src/modules/library/i18n/en.json'), '{}\n')
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.localized-ui')?.passed, true)
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')?.passed, false)
    assert.match(result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')?.requirement ?? '', /en\.json.*library\.books\.title/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle accepts nested base and emitted sibling locale catalogs', () => {
  const root = stageTarget('src/modules/library/backend/books/page.tsx', `
export function useT() { return (key: string) => key }
export const metadata = {
  pageTitleKey: 'library.books.title',
  pageGroupKey: 'library.navigation.group',
  breadcrumb: [{ label: 'Books', labelKey: 'library.books.breadcrumb' }],
}
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`)
  const catalogs = {
    en: { library: { books: { title: 'Books', breadcrumb: 'Books' }, navigation: { group: 'Library' } } },
    de: { library: { books: { title: 'Bücher', breadcrumb: 'Bücher' }, navigation: { group: 'Bibliothek' } } },
  }
  fs.mkdirSync(path.join(root, 'src/modules/library/i18n'), { recursive: true })
  for (const [locale, catalog] of Object.entries(catalogs)) {
    fs.writeFileSync(path.join(root, `src/modules/library/i18n/${locale}.json`), `${JSON.stringify(catalog)}\n`)
  }
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')?.passed, true)
    fs.writeFileSync(path.join(root, 'src/modules/library/i18n/de.json'), `${JSON.stringify({
      library: { books: { title: 'Bücher' }, navigation: { group: 'Bibliothek' } },
    })}\n`)
    const missingMetadataResult = runOracle(root, 'before', process.env, 'OMH-185')
    const localeCheck = missingMetadataResult.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /de\.json library\.books\.breadcrumb is missing/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle ignores locale-like literals outside routed UI and navigation sources', () => {
  const root = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`, { en: { library: { books: { title: 'Books' } } } })
  const sources = {
    'src/modules/library/backend/books/books.test.tsx': `t('library.tests.backend')\n`,
    'src/modules/library/commands/__tests__/books.test.ts': `t('library.tests.command')\n`,
    'src/modules/library/data/validators.ts': `t('library.validation.internal')\n`,
    'src/modules/library/migrations/Migration20260731000000.ts': `t('library.migrations.internal')\n`,
  }
  for (const [relative, source] of Object.entries(sources)) {
    const absolute = path.join(root, relative)
    fs.mkdirSync(path.dirname(absolute), { recursive: true })
    fs.writeFileSync(absolute, source)
  }
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle rejects missing, blank, and non-string locale leaves', () => {
  const scenarios = [
    { catalog: { library: { books: {} } }, reason: 'is missing' },
    { catalog: { library: { books: { title: '   ' } } }, reason: 'is blank' },
    { catalog: { library: { books: { title: ['Books'] } } }, reason: 'is not a string' },
  ]
  for (const scenario of scenarios) {
    const root = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`, { en: scenario.catalog })
    try {
      const result = runOracle(root, 'before', process.env, 'OMH-185')
      const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
      assert.equal(localeCheck?.passed, false)
      assert.match(localeCheck?.requirement ?? '', new RegExp(`en\\.json library\\.books\\.title ${scenario.reason}`))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('the complete module oracle requires sibling parity while excluding shared translation keys', () => {
  const source = `
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}{t('common.actions.cancel')}</Page>
}
`
  const passingRoot = stageLocaleTarget(source, {
    en: { library: { books: { title: 'Books' } } },
    de: { library: { books: { title: 'Bücher' } } },
  })
  try {
    const result = runOracle(passingRoot, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')?.passed, true)
  } finally {
    fs.rmSync(passingRoot, { recursive: true, force: true })
  }

  const failingRoot = stageLocaleTarget(source, {
    en: { library: { books: { title: 'Books' } } },
    de: { library: { books: {} } },
  })
  try {
    const result = runOracle(failingRoot, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /de\.json library\.books\.title is missing/)
    assert.doesNotMatch(localeCheck?.requirement ?? '', /common\.actions\.cancel/)
  } finally {
    fs.rmSync(failingRoot, { recursive: true, force: true })
  }
})

test('the complete module oracle rejects dynamic-only and dangerous module locale keys', () => {
  const dynamicRoot = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage(name: string) {
  const t = useT()
  return <Page>{t(\`library.books.\${name}\`)}</Page>
}
`, { en: { library: { books: { title: 'Books' } } } })
  try {
    const result = runOracle(dynamicRoot, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /no literal library\./)
  } finally {
    fs.rmSync(dynamicRoot, { recursive: true, force: true })
  }

  const dangerousRoot = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.__proto__.title')}</Page>
}
`, { en: '{"library":{"__proto__":{"title":"unsafe"}}}\n' })
  try {
    const result = runOracle(dangerousRoot, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /contains a dangerous path segment/)
  } finally {
    fs.rmSync(dangerousRoot, { recursive: true, force: true })
  }
})

test('the complete module oracle returns bounded sanitized failures for malformed and excessive locale input', () => {
  const source = `
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`
  const scenarios: Array<{ catalogs: Record<string, unknown | string>; expected: RegExp }> = [
    { catalogs: { en: '{"library":' }, expected: /en\.json contains malformed JSON/ },
    { catalogs: { en: [] }, expected: /en\.json root is not a plain object/ },
    { catalogs: { de: { library: { books: { title: 'Bücher' } } } }, expected: /en\.json is missing/ },
    { catalogs: { en: ' '.repeat(256 * 1024 + 1) }, expected: /en\.json exceeds 262144 bytes/ },
    {
      catalogs: Object.fromEntries(['en', ...Array.from({ length: 16 }, (_, index) => `locale-${index}`)]
        .map((locale) => [locale, { library: { books: { title: 'Books' } } }])),
      expected: /locale file count exceeds 16/,
    },
    {
      catalogs: Object.fromEntries(['en', ...Array.from({ length: 15 }, (_, index) => `locale-${index}`)]
        .map((locale) => [locale, `${JSON.stringify({ library: { books: { title: 'Books' } } })}${' '.repeat(70 * 1024)}`])),
      expected: /locale input exceeds 1048576 total bytes/,
    },
  ]
  for (const scenario of scenarios) {
    const root = stageLocaleTarget(source, scenario.catalogs)
    try {
      const result = runOracle(root, 'before', process.env, 'OMH-185')
      const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
      assert.equal(localeCheck?.passed, false)
      assert.match(localeCheck?.requirement ?? '', scenario.expected)
      assert.doesNotMatch(localeCheck?.requirement ?? '', new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  }
})

test('the complete module oracle bounds literal module locale key extraction', () => {
  const calls = Array.from({ length: 257 }, (_, index) => `t('library.books.key${index}')`).join('\n  ')
  const root = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  ${calls}
  return <Page />
}
`, { en: { library: { books: {} } } })
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /more than 256 literal library\. keys/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle reports a missing locale directory as a structured check failure', () => {
  const root = stageTarget('src/modules/library/backend/books/page.tsx', `
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /i18n directory is missing/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle rejects symlinked locale catalogs without leaking absolute paths', { skip: process.platform === 'win32' }, () => {
  const root = stageLocaleTarget(`
export function useT() { return (key: string) => key }
export function BooksPage() {
  const t = useT()
  return <Page>{t('library.books.title')}</Page>
}
`, { en: { library: { books: { title: 'Books' } } } })
  fs.symlinkSync('en.json', path.join(root, 'src/modules/library/i18n/de.json'))
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    const localeCheck = result.parsed.checks.find((entry) => entry.id === 'module.locale-catalog')
    assert.equal(localeCheck?.passed, false)
    assert.match(localeCheck?.requirement ?? '', /symbolic_link/)
    assert.doesNotMatch(localeCheck?.requirement ?? '', new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the business-language complete module case reuses the OMH-185 trusted oracle', () => {
  const root = stageTarget('src/modules/library/index.ts', 'export const metadata = {}\n')
  try {
    const technicalResult = runOracle(root, 'before', process.env, 'OMH-185')
    const businessResult = runOracle(root, 'before', process.env, 'OMH-193')
    assert.deepEqual(businessResult.parsed, technicalResult.parsed)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle requires atomic and undo seams on each declared command', () => {
  const root = stageTarget('src/modules/library/commands/books.ts', `
function withAtomicFlush() {}
function enforceCommandOptimisticLock() {}
function extractUndoPayload() {}
function buildCustomFieldResetMap() {}
function emitCrudSideEffects() {}
function emitCrudUndoSideEffects() {}

withAtomicFlush({}, [], { transaction: true })
enforceCommandOptimisticLock()
extractUndoPayload()
buildCustomFieldResetMap()
emitCrudSideEffects()
emitCrudUndoSideEffects()

export const createBook = { execute() {}, buildLog() {}, undo() {} }
export const updateBook = { execute() {}, buildLog() {}, undo() {} }
export const deleteBook = { execute() {}, buildLog() {}, undo() {} }
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.command-atomic')?.passed, false)
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.command-undo')?.passed, false)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the complete module oracle accepts suffixed command-local atomic and undo behavior', () => {
  const root = stageTarget('src/modules/library/commands/books.ts', `
function withAtomicFlush() {}
function enforceCommandOptimisticLock() {}
function extractUndoPayload() {}
function buildCustomFieldResetMap() {}
function emitCrudSideEffects() {}
function emitCrudUndoSideEffects() {}

export const createBookCommand = {
  execute() { withAtomicFlush({}, [], { transaction: true }); emitCrudSideEffects() },
  buildLog() {},
  undo() { extractUndoPayload(); emitCrudUndoSideEffects() },
}
export const updateBookCommand = {
  execute() { withAtomicFlush({}, [], { transaction: true }); enforceCommandOptimisticLock(); emitCrudSideEffects() },
  buildLog() { buildCustomFieldResetMap() },
  undo() { extractUndoPayload(); buildCustomFieldResetMap(); emitCrudUndoSideEffects() },
}
export const deleteBookCommand = {
  execute() { withAtomicFlush({}, [], { transaction: true }); enforceCommandOptimisticLock(); emitCrudSideEffects() },
  buildLog() { buildCustomFieldResetMap() },
  undo() { extractUndoPayload(); buildCustomFieldResetMap(); emitCrudUndoSideEffects() },
}
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-185')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.command-atomic')?.passed, true)
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'module.command-undo')?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
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

test('the CRM library regression oracle requires scoped behavior, public schemas, and executable Jest structure', () => {
  const root = stageTarget('src/modules/library/commands/crm-loans.ts', `
export function requireTrustedScope(scope: { tenantId?: string; organizationId?: string }) {
  if (!scope.tenantId || !scope.organizationId) throw new Error('scope required')
  return scope
}
export async function createBook(input: any, scope: any, effects: any) { return effects.createBook(input, requireTrustedScope(scope)) }
export async function undoCreateBook(id: string, scope: any, effects: any) { return effects.softDeleteBook(id, requireTrustedScope(scope)) }
export async function deleteBook(id: string, scope: any, effects: any) { return effects.softDeleteBook(id, requireTrustedScope(scope)) }
export async function undoDeleteBook(id: string, scope: any, effects: any) { return effects.restoreBook(id, requireTrustedScope(scope)) }
export async function checkoutBook(input: any, scope: any, effects: any) {
  const trusted = requireTrustedScope(scope)
  const customer = await effects.resolveCustomer(input.customerEntityId, trusted)
  return effects.claimCheckout({ bookId: input.bookId, customerEntityId: customer.id, customerNameSnapshot: customer.displayName, idempotencyKey: input.idempotencyKey }, trusted)
}
export async function returnLoan(input: any, scope: any, effects: any) { const trusted = requireTrustedScope(scope); await effects.findLoan(input.id, trusted); return effects.updateLoan(input.id, trusted, { status: 'returned' }) }
export async function renewLoan(input: any, scope: any, effects: any) { const trusted = requireTrustedScope(scope); await effects.findLoan(input.id, trusted); return effects.updateLoan(input.id, trusted, { status: 'renewed' }) }
export async function markLoanLost(input: any, scope: any, effects: any) { const trusted = requireTrustedScope(scope); await effects.findLoan(input.id, trusted); return effects.updateLoan(input.id, trusted, { status: 'lost' }) }
`)
  const schema = path.join(root, 'src/modules/library/api/schemas.ts')
  const generatedTest = path.join(root, 'src/modules/library/commands/__tests__/crm-loans.test.ts')
  fs.mkdirSync(path.dirname(schema), { recursive: true })
  fs.mkdirSync(path.dirname(generatedTest), { recursive: true })
  fs.writeFileSync(schema, `
import { z } from 'zod'
export const createBookRequestSchema = z.object({ title: z.string() })
export const checkoutBookRequestSchema = z.object({ bookId: z.string(), customerEntityId: z.string(), idempotencyKey: z.string() })
`)
  fs.writeFileSync(generatedTest, `
import { describe, expect, it } from '@jest/globals'
import { checkoutBook, createBook, deleteBook, markLoanLost, renewLoan, returnLoan, undoCreateBook, undoDeleteBook } from '../crm-loans'
describe('CRM loans', () => {
  it('covers lifecycle and scoped actions', async () => {
    await createBook({}, {}, {})
    await undoCreateBook('', {}, {})
    await deleteBook('', {}, {})
    await undoDeleteBook('', {}, {})
    await returnLoan({}, {}, {})
    await renewLoan({}, {}, {})
    await markLoanLost({}, {}, {})
    await Promise.all([checkoutBook({}, {}, {}), checkoutBook({}, {}, {})])
    await checkoutBook({}, {}, {})
    expect(true).toBe(true)
  })
})
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-192')
    const crmChecks = result.parsed.checks.filter((entry) => entry.id.startsWith('crm-library.'))
    assert.ok(crmChecks.length >= 8)
    assert.ok(crmChecks.every((entry) => entry.passed), result.parsed.failures.join('\n'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the generative business oracles reject disconnected vocabulary and accept connected contracts', () => {
  const scenarios = [
    {
      caseId: 'OMH-188',
      file: 'src/modules/room_bookings/commands/bookings.ts',
      checkIds: ['overlap.conflict-mapping', 'overlap.command-atomic', 'overlap.command-undo'],
      disconnected: `
function withAtomicFlush() {}
function extractUndoPayload() {}
function emitCrudSideEffects() {}
function emitCrudUndoSideEffects() {}
function registerCommand(_command: unknown) {}
function makeCrudRoute(_options: unknown) {}
class CrudHttpError {}
withAtomicFlush({}, [], { transaction: true })
extractUndoPayload()
emitCrudSideEffects()
emitCrudUndoSideEffects()
new CrudHttpError()
const code = '23P01'
const createBooking = { id: 'room_bookings.bookings.create', execute() {}, undo() {} }
const updateBooking = { id: 'room_bookings.bookings.update', execute() {}, undo() {} }
const deleteBooking = { id: 'room_bookings.bookings.delete', execute() {}, undo() {} }
registerCommand(createBooking)
registerCommand(updateBooking)
registerCommand(deleteBooking)
makeCrudRoute({
  metadata: {}, orm: {}, list: {}, indexer: {},
  actions: {
    create: { commandId: 'room_bookings.bookings.decoy-create' },
    update: { commandId: 'room_bookings.bookings.decoy-update' },
    delete: { commandId: 'room_bookings.bookings.decoy-delete' },
  },
})
`,
      connected: `
function withAtomicFlush(_em: unknown, _records: unknown[], _options: { transaction: boolean }) {}
function extractUndoPayload() {}
function emitCrudSideEffects() {}
function emitCrudUndoSideEffects() {}
function registerCommand(_command: unknown) {}
function makeCrudRoute(_options: unknown) {}
class CrudHttpError {}
const mapBookingError = (error: { code?: string }) => {
  if (error.code === '23P01') throw new CrudHttpError()
  throw error
}
const executeBooking = () => {
  try {
    withAtomicFlush({}, [], { transaction: true })
    emitCrudSideEffects()
  } catch (error) {
    mapBookingError(error as { code?: string })
  }
}
const undoBooking = () => { extractUndoPayload(); emitCrudUndoSideEffects() }
const createBooking = ({ id: 'room_bookings.bookings.create', execute: executeBooking, undo: undoBooking }) satisfies Record<string, unknown>
const updateBooking = ({ id: 'room_bookings.bookings.update', execute: executeBooking, undo: undoBooking }) as Record<string, unknown>
const deleteBooking = { id: 'room_bookings.bookings.delete', execute: executeBooking, undo: undoBooking }
registerCommand(createBooking)
registerCommand(updateBooking)
registerCommand(deleteBooking)
makeCrudRoute({
  metadata: {}, orm: {}, list: {}, indexer: {},
  actions: {
    create: { commandId: 'room_bookings.bookings.create' },
    update: { commandId: 'room_bookings.bookings.update' },
    delete: { commandId: 'room_bookings.bookings.delete' },
  },
})
`,
    },
    {
      caseId: 'OMH-189',
      file: 'src/modules/room_calendar_sync/lib/client.ts',
      checkIds: ['provider.ssrf-guard', 'provider.idempotency-key', 'provider.redirect-refusal', 'provider.bounded-retry'],
      disconnectedCheckIds: ['provider.ssrf-guard', 'provider.idempotency-key', 'provider.redirect-refusal'],
      disconnected: `
export function assertSafeEndpoint(value: string) {
  if (!value.startsWith('https:')) throw new Error('unsafe')
}
export function createRoomCalendarClient() {
  const disconnectedRequest = () => {
    assertSafeEndpoint('https://calendar.example')
    return fetch('https://calendar.example', { redirect: 'manual', headers: { 'idempotency-key': 'decoy' } })
  }
  void disconnectedRequest
  for (let attempt = 0; attempt < 2; attempt += 1) void attempt
}
`,
      connected: `
export const assertSafeEndpoint = ((value: string) => {
  if (!value.startsWith('https:')) throw new Error('unsafe')
}) satisfies (value: string) => void
async function request(endpoint: string, key: string) {
  return fetch(endpoint, { redirect: 'manual', headers: { 'idempotency-key': key } })
}
export const createRoomCalendarClient = (endpoint: string, key: string) => {
  return {
    async pushBooking() {
      assertSafeEndpoint(endpoint)
      for (let attempt = 0; attempt < 2; attempt += 1) await request(endpoint, key)
    },
  }
}
`,
    },
    {
      caseId: 'OMH-190',
      file: 'src/modules/room_bookings/data/enrichers.ts',
      checkIds: ['enricher.dot-target', 'enricher.batched', 'enricher.namespaced', 'enricher.resilience', 'enricher.acl'],
      disconnected: `
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
const decoy: ResponseEnricher = {
  targetEntity: 'customers.person',
  features: ['room_bookings.bookings.view'],
  fallback: { _room_bookings: { confirmed: 0 } },
  timeout: 100,
  cacheableOnListHit: false,
  enrichOne(record: Record<string, unknown>) { return { ...record, _room_bookings: { confirmed: 0 } } },
  enrichMany(records: Array<Record<string, unknown>>) {
    return records.map((record) => ({ ...record, _room_bookings: { confirmed: 0 } }))
  },
}
void decoy
export const enrichers = [] satisfies ResponseEnricher[]
`,
      connected: `
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
const bookingSummary = ({
  targetEntity: 'customers.person',
  features: ['room_bookings.bookings.view'],
  fallback: { _room_bookings: { confirmed: 0 } },
  timeout: 100,
  cacheableOnListHit: false,
  enrichOne(record: Record<string, unknown>) { return { ...record, _room_bookings: { confirmed: 0 } } },
  async enrichMany(records: Array<Record<string, unknown>>, context: { em: { fork(): { find(entity: string, where: unknown): Promise<unknown[]> } } }) {
    const customerIds = records.map((record) => record.id)
    await context.em.fork().find('RoomBooking', { customerId: { $in: customerIds } })
    return records.map((record) => ({ ...record, _room_bookings: { confirmed: 0 } }))
  },
}) satisfies ResponseEnricher
export const enrichers = ([bookingSummary] as const) satisfies readonly ResponseEnricher[]
`,
    },
    {
      caseId: 'OMH-191',
      file: 'src/modules/room_bookings/workflows.ts',
      checkIds: ['workflow.timer-config', 'workflow.safe-commands', 'workflow.terminal-graph', 'workflow.confirmation-beats-expiry', 'workflow.dispatch-update-entity'],
      disconnectedCheckIds: ['workflow.safe-commands', 'workflow.terminal-graph', 'workflow.confirmation-beats-expiry', 'workflow.dispatch-update-entity'],
      disconnected: `
declare function defineWorkflow(value: unknown): unknown
declare function registerWorkflowSafeCommands(value: unknown): void
declare function createWorkflowsModuleConfig(value: unknown): unknown
const workflow = defineWorkflow({
  steps: [
    { id: 'START' },
    { id: 'expiry', stepType: 'WAIT_FOR_TIMER', config: { duration: 'PT15M' } },
    { id: 'release', activity: 'UPDATE_ENTITY', config: { commandId: 'room_bookings.bookings.update' } },
    { id: 'END' },
  ],
  transitions: [
    { from: 'START', to: 'expiry', trigger: 'timer' },
    { from: 'expiry', to: 'END', trigger: 'signal' },
  ],
})
registerWorkflowSafeCommands([
  { commandId: 'room_bookings.bookings.update' },
  { commandId: 'decoy', requiredFeatures: ['room_bookings.bookings.update'] },
])
export const workflowsConfig = createWorkflowsModuleConfig([workflow])
`,
      connected: `
declare function defineWorkflow(value: unknown): unknown
declare function registerWorkflowSafeCommands(value: unknown): void
declare function createWorkflowsModuleConfig(value: unknown): unknown
const workflowDefinition = ({
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'held', stepName: 'Held', stepType: 'WAIT_FOR_TIMER', config: { duration: 'PT15M' } },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ] as const,
  transitions: [
    { transitionId: 'start-held', fromStepId: 'start', toStepId: 'held', trigger: 'auto', priority: 100 },
    { transitionId: 'confirm', fromStepId: 'held', toStepId: 'end', trigger: 'signal', priority: 100 },
    {
      transitionId: 'expire',
      fromStepId: 'held',
      toStepId: 'end',
      trigger: 'timer',
      priority: 10,
      activities: [{
        activityId: 'release',
        activityName: 'Release booking',
        activityType: 'UPDATE_ENTITY',
        config: { commandId: 'room_bookings.bookings.update', input: {} },
      }],
    },
  ],
}) as const satisfies Record<string, unknown>
const workflow = defineWorkflow(workflowDefinition)
const safeCommands = ([{
  commandId: 'room_bookings.bookings.update',
  requiredFeatures: ['room_bookings.bookings.manage'],
}] as const) satisfies readonly unknown[]
registerWorkflowSafeCommands(safeCommands)
export const workflowsConfig = createWorkflowsModuleConfig([workflow])
`,
    },
  ] as const

  for (const scenario of scenarios) {
    const disconnectedRoot = stageTarget(scenario.file, scenario.disconnected)
    try {
      const result = runOracle(disconnectedRoot, 'before', process.env, scenario.caseId)
      assert.notEqual(result.status, 2, `${scenario.caseId}: ${result.parsed.failures.join('\n')}`)
      for (const checkId of ('disconnectedCheckIds' in scenario ? scenario.disconnectedCheckIds : scenario.checkIds)) {
        assert.equal(result.parsed.checks.find((entry) => entry.id === checkId)?.passed, false, `${scenario.caseId} ${checkId}`)
      }
    } finally {
      fs.rmSync(disconnectedRoot, { recursive: true, force: true })
    }

    const connectedRoot = stageTarget(scenario.file, scenario.connected)
    try {
      const result = runOracle(connectedRoot, 'before', process.env, scenario.caseId)
      for (const checkId of scenario.checkIds) {
        assert.equal(result.parsed.checks.find((entry) => entry.id === checkId)?.passed, true, `${scenario.caseId} ${checkId}`)
      }
    } finally {
      fs.rmSync(connectedRoot, { recursive: true, force: true })
    }
  }
})

test('OMH-190 rejects a registered constant-map placeholder without a booking read', () => {
  const root = stageTarget('src/modules/room_bookings/data/enrichers.ts', `
import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
const placeholder: ResponseEnricher = {
  id: 'room_bookings.summary',
  targetEntity: 'customers.person',
  features: ['room_bookings.bookings.view'],
  fallback: { _room_bookings: { confirmed: 0 } },
  timeout: 100,
  cacheableOnListHit: false,
  async enrichOne(record: Record<string, unknown>) {
    return { ...record, _room_bookings: { confirmed: 0 } }
  },
  async enrichMany(records: Array<Record<string, unknown>>) {
    return records.map((record) => ({ ...record, _room_bookings: { confirmed: 0 } }))
  },
}
export const enrichers = [placeholder]
`)
  try {
    const result = runOracle(root, 'before', process.env, 'OMH-190')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'enricher.batched')?.passed, false)
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

test('the trusted oracle rejects duplicate normalized API route methods', () => {
  const root = stageTarget('src/modules/library/api/books/[id]/route.ts', 'export function GET() {}\n')
  const duplicate = path.join(root, 'src/modules/duplicate/api/records/[recordId]/route.ts')
  fs.mkdirSync(path.dirname(duplicate), { recursive: true })
  fs.writeFileSync(duplicate, "export const metadata = { path: '/library/books/[bookId]' }\nexport function GET() {}\n")
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'routes.unique')?.passed, false)
    assert.match(result.parsed.failures.join('\n'), /api:\/library\/books\/\[\]/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the trusted oracle rejects API routes that shadow installed module facts', () => {
  const root = stageTarget('src/modules/library/api/books/[bookId]/route.ts', 'export function GET() {}\n')
  writeModuleFacts(root, {})
  writeModuleFacts(root, {
    catalog: {
      sourceRoot: 'node_modules/@open-mercato/core/src/modules/catalog',
      apiRoutes: [{
        path: '/library/books/[id]',
        methods: ['GET'],
        sourcePath: 'node_modules/@open-mercato/core/src/modules/catalog/api/books/[id]/route.ts',
      }],
      backendPages: [],
      frontendPages: [],
    },
  }, 2)
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'routes.unique')?.passed, false)
    assert.match(result.parsed.failures.join('\n'), /api:\/library\/books\/\[\]/)
    assert.match(result.parsed.failures.join('\n'), /node_modules\/@open-mercato\/core\/src\/modules\/catalog/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the trusted oracle permits distinct methods on one legacy API URL', () => {
  const root = stageTarget('src/modules/library/api/get/books.ts', 'export default function GET() {}\n')
  const post = path.join(root, 'src/modules/library/api/post/books.ts')
  fs.mkdirSync(path.dirname(post), { recursive: true })
  fs.writeFileSync(post, 'export default function POST() {}\n')
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'routes.unique')?.passed, true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the trusted oracle rejects duplicate normalized backend and frontend pages', () => {
  const root = stageTarget('src/modules/library/backend/[id]/page.tsx', 'export default function Page() { return null }\n')
  const backendDuplicate = path.join(root, 'src/modules/duplicate/backend/[recordId]/page.tsx')
  const frontendOne = path.join(root, 'src/modules/library/frontend/orders/[id]/page.tsx')
  const frontendDuplicate = path.join(root, 'src/modules/duplicate/frontend/orders/[orderId]/page.tsx')
  for (const file of [backendDuplicate, frontendOne, frontendDuplicate]) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, 'export default function Page() { return null }\n')
  }
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'routes.unique')?.passed, false)
    assert.match(result.parsed.failures.join('\n'), /backend:\/backend\/\[\]/)
    assert.match(result.parsed.failures.join('\n'), /frontend:\/orders\/\[\]/)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('the trusted oracle derives page URLs from files and rejects installed page collisions', () => {
  const root = stageTarget(
    'src/modules/library/backend/books/[bookId]/page.tsx',
    'export default function Page() { return null }\n',
  )
  const frontendPage = path.join(root, 'src/modules/library/frontend/orders/[orderId]/page.tsx')
  const frontendMetadata = path.join(root, 'src/modules/library/frontend/orders/[orderId]/page.meta.ts')
  fs.mkdirSync(path.dirname(frontendPage), { recursive: true })
  fs.writeFileSync(frontendPage, 'export default function Page() { return null }\n')
  fs.writeFileSync(frontendMetadata, "export const metadata = { path: '/not-the-generated-route' }\n")
  writeModuleFacts(root, {
    catalog: {
      sourceRoot: 'node_modules/@open-mercato/core/src/modules/catalog',
      apiRoutes: [],
      backendPages: [{
        path: '/backend/books/[id]',
        sourcePath: 'node_modules/@open-mercato/core/src/modules/catalog/backend/books/[id]/page.tsx',
      }],
      frontendPages: [{
        path: '/orders/[id]',
        sourcePath: 'node_modules/@open-mercato/core/src/modules/catalog/frontend/orders/[id]/page.tsx',
      }],
    },
  })
  try {
    const result = runOracle(root, 'before')
    assert.equal(result.parsed.checks.find((entry) => entry.id === 'routes.unique')?.passed, false)
    assert.match(result.parsed.failures.join('\n'), /backend:\/backend\/books\/\[\]/)
    assert.match(result.parsed.failures.join('\n'), /frontend:\/orders\/\[\]/)
    assert.doesNotMatch(result.parsed.failures.join('\n'), /not-the-generated-route/)
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

function writeRecoverySources(root: string, sources: Record<string, string>) {
  const compiler: typeof import('typescript-standalone') = require('typescript-standalone')
  for (const [relative, source] of Object.entries(sources)) {
    const parsed = compiler.createSourceFile(relative, source, compiler.ScriptTarget.Latest, true)
    assert.equal((parsed as typeof parsed & { parseDiagnostics: readonly unknown[] }).parseDiagnostics.length, 0, `invalid recovery fixture ${relative}`)
    const destination = path.join(root, relative)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, source)
  }
}

const recoveryFixtures: Record<string, Record<string, string>> = {
  'OMH-014': {
    'src/modules/library/backend/books/page.tsx': "import { Books } from '../../components/Books'\nexport default function Page() { return <Books /> }",
    'src/modules/library/components/Books.tsx': "import { DataTable } from '@open-mercato/ui/backend/DataTable'\nimport { CrudForm } from '@open-mercato/ui/backend/CrudForm'\nimport { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'\nexport function Books() { const onError = (error: unknown) => surfaceRecordConflict(error, key => key); return <><DataTable extensionTableId='library.books' /><CrudForm initialValues={{}} onSubmit={onError} /></> }",
  },
  'OMH-026': {
    'src/modules/app_customizations/widgets/injection-table.ts': "export const injectionTable = { 'crud-form:customers.person:fields': 'app_customizations.note' }",
    'src/modules/app_customizations/data/enrichers.ts': "import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'\nconst note: ResponseEnricher = { id: 'app_customizations.note', targetEntity: 'customers.person', async enrichMany(records, context) { return records.map(record => ({ ...record, _app_customizations: { note: null, tenantId: context.tenantId, organizationId: context.organizationId } })) } }\nexport const enrichers = [note]",
    'src/modules/app_customizations/api/interceptors.ts': "export const interceptors = [{ id: 'app_customizations.note', targetRoute: 'customers/people', methods: ['PUT'], async before(request) { return { ok: true, body: request.body } } }]",
  },
  'OMH-027': {
    'src/modules/app_customizations/widgets/injection-table.ts': "export const injectionTable = { 'data-table:customers.people:columns': { widgetId: 'app_customizations.note-column', priority: 30 } }",
    'src/modules/app_customizations/widgets/injection/note-column/widget.ts': "import type { InjectionColumnWidget } from '@open-mercato/shared/modules/widgets/injection'\nconst widget: InjectionColumnWidget = { metadata: { id: 'app_customizations.note-column', requiredModules: ['customers'] }, columns: [{ id: 'note', accessorKey: '_app_customizations.note', header: 'app_customizations.note' }] }\nexport default widget",
  },
  'OMH-029': {
    'src/modules/app_customizations/index.ts': "export const metadata = { id: 'app_customizations' }",
    'src/modules/app_customizations/overrides.ts': "import type { ModuleOverrides } from '@open-mercato/shared/modules/overrides'\nexport const overrides: ModuleOverrides = { routes: { pages: { '/backend/example/reports': null } } }",
    'src/modules.ts': "import { overrides } from './modules/app_customizations/overrides'\nexport const enabledModules = [{ id: 'example', from: '@app' }, { id: 'app_customizations', from: '@app', overrides }]",
  },
  'OMH-031': {
    'src/modules/app_customizations/api/interceptors.ts': "import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'\nexport const interceptors: ApiInterceptor[] = [{ id: 'app_customizations.scope', targetRoute: 'customers/people', methods: ['GET'], timeoutMs: 1000, async before(request, context) { if (!context.tenantId || !context.organizationId) return { ok: false, statusCode: 403 }; return { ok: true, query: { ...request.query, tenantId: context.tenantId, organizationId: context.organizationId } } } }]",
  },
  'OMH-049': {
    'src/modules/library/ai-agents.ts': "import { defineAiAgent } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'\nconst librarian = defineAiAgent({ id: 'library.librarian', moduleId: 'library', label: 'Librarian', defaultProvider: 'openai', defaultModel: 'model', allowedTools: ['library.list'], requiredFeatures: ['library.books.view'] })\nexport const aiAgents = [librarian]",
  },
  'OMH-054': {
    'src/modules/automation/workflows/call-api.ts': "export type Input = { url: string; idempotencyKey: string }\nexport type Effects = { reserveIdempotency(key: string): Promise<string>; transaction<T>(work: () => Promise<T>): Promise<T>; post(url: string, options: { idempotencyKey: string }): Promise<unknown> }\nexport async function callApiActivity(input: Input, effects: Effects) { const key = await effects.reserveIdempotency(input.idempotencyKey); return effects.transaction(async () => effects.post(input.url, { idempotencyKey: key })) }",
  },
}

for (const [caseId, sources] of Object.entries(recoveryFixtures)) {
  test(`recovery ${caseId} accepts its connected current framework contract`, () => {
    const root = stageTarget('src/fixture.ts', 'export {}')
    try {
      writeRecoverySources(root, sources)
      const result = runOracle(root, 'before', process.env, caseId)
      assert.equal(result.parsed.passed, true, JSON.stringify(result.parsed.failures))
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}

const recoveryNegatives: Array<{ caseId: string; label: string; mutate: (sources: Record<string, string>) => Record<string, string> }> = [
  { caseId: 'OMH-014', label: 'orphan component', mutate: sources => ({ ...sources, 'src/modules/library/backend/books/page.tsx': 'export default function Page() { return <div /> }' }) },
  { caseId: 'OMH-014', label: 'unused component import', mutate: sources => ({ ...sources, 'src/modules/library/backend/books/page.tsx': "import { Books } from '../../components/Books'\nexport default function Page() { return <div /> }" }) },
  { caseId: 'OMH-014', label: 'import escaping the case module', mutate: sources => ({ ...sources, 'src/modules/library/backend/books/page.tsx': "import { Books } from '../../../other/Books'\nexport default function Page() { return <Books /> }", 'src/modules/other/Books.tsx': sources['src/modules/library/components/Books.tsx'] }) },
  { caseId: 'OMH-014', label: 'import escaping the target root', mutate: sources => ({ ...sources, 'src/modules/library/backend/books/page.tsx': "import { Books } from '../../../../../../outside/Books'\nexport default function Page() { return <Books /> }" }) },
  { caseId: 'OMH-014', label: 'rendered non-component export', mutate: sources => ({ ...sources, 'src/modules/library/components/Books.tsx': 'export const Books = 42' }) },
  { caseId: 'OMH-014', label: 'nonexistent rendered import', mutate: sources => ({ ...sources, 'src/modules/library/backend/books/page.tsx': "import { Books } from '../../components/Missing'\nexport default function Page() { return <Books /> }" }) },
  { caseId: 'OMH-026', label: 'empty registered enricher', mutate: sources => ({ ...sources, 'src/modules/app_customizations/data/enrichers.ts': "import type { ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'\nexport const enrichers: ResponseEnricher[] = [{ id: 'empty', targetEntity: 'customers.person', async enrichMany() { return [] } }]" }) },
  { caseId: 'OMH-026', label: 'disconnected enrichMany call', mutate: sources => ({ ...sources, 'src/modules/app_customizations/data/enrichers.ts': "function unused() { enrichMany([]) }\nexport const enrichers = []" }) },
  { caseId: 'OMH-026', label: 'unexported enricher', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('export const enrichers', 'const enrichers')])) },
  { caseId: 'OMH-027', label: 'disconnected typed widget', mutate: sources => ({ ...sources, 'src/modules/app_customizations/widgets/injection-table.ts': "export const injectionTable = { 'data-table:customers.people:columns': { widgetId: 'other.widget' } }; const options = { extensionTableId: 'customers.people' }" }) },
  { caseId: 'OMH-027', label: 'nonmountable base host', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('data-table:customers.people:columns', 'data-table:')])) },
  { caseId: 'OMH-027', label: 'missing widget default export', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('export default widget', 'export const unused = widget')])) },
  { caseId: 'OMH-029', label: 'unimported same-named overrides', mutate: sources => ({ ...sources, 'src/modules/app_customizations/aaa-empty.ts': 'export const overrides = {}', 'src/modules.ts': sources['src/modules.ts'].replace('./modules/app_customizations/overrides', './modules/app_customizations/aaa-empty') }) },
  { caseId: 'OMH-029', label: 'disconnected page map', mutate: sources => ({ ...sources, 'src/modules.ts': "export const enabledModules = [{ id: 'app_customizations', from: '@app' }]" }) },
  { caseId: 'OMH-029', label: 'singular page property', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('pages:', 'page:')])) },
  { caseId: 'OMH-029', label: 'nonfunction page loader', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace("'/backend/example/reports': null", "'/backend/example/reports': { load: 'not-a-loader' }")])) },
  { caseId: 'OMH-029', label: 'invented replace URL', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace("'/backend/example/reports': null", "'/backend/example/reports': { replace: '/backend/other' }")])) },
  { caseId: 'OMH-031', label: 'unused imported type with untyped registry', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('interceptors: ApiInterceptor[]', 'interceptors')])) },
  { caseId: 'OMH-031', label: 'metadata read without before handoff', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace(/}\s*\]$/, ', async after(request, response, context) { return { merge: { approved: context.metadata?.approved } } } }]')])) },
  { caseId: 'OMH-031', label: 'untrusted request scope', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replaceAll('context.tenantId', 'request.body?.tenantId').replaceAll('context.organizationId', 'request.body?.organizationId')])) },
  { caseId: 'OMH-031', label: 'obsolete match shape', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace("targetRoute: 'customers/people', methods: ['GET']", "match: { path: '/api/customers/people', methods: ['GET'] }")])) },
  { caseId: 'OMH-031', label: 'orphan typed interceptor', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('export const interceptors', 'const interceptors')])) },
  { caseId: 'OMH-049', label: 'unregistered agent in dead helper', mutate: sources => ({ 'src/modules/library/ai-agents.ts': "function unused() { return defineAiAgent({ provider: 'x', model: 'x', allowedTools: [], requiredFeatures: [] }) }; export const aiAgents = []" }) },
  { caseId: 'OMH-049', label: 'obsolete provider model options', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('defaultProvider:', 'provider:').replace('defaultModel:', 'model:')])) },
  { caseId: 'OMH-054', label: 'dead fetch header helper', mutate: () => ({ 'src/modules/automation/workflows/call-api.ts': "export async function callApiActivity(input, effects) { return effects.post(input.url, { idempotencyKey: input.idempotencyKey }) }\nfunction unused() { transaction(); fetch('CALL_API', { headers: { 'Idempotency-Key': 'fake' } }) }" }) },
  { caseId: 'OMH-054', label: 'dead arrow effects helper', mutate: () => ({ 'src/modules/automation/workflows/call-api.ts': "export async function callApiActivity(input, effects) { const unused = async () => { const key = await effects.reserveIdempotency(input.idempotencyKey); return effects.transaction(() => effects.post(input.url, { idempotencyKey: key })) }; return undefined }" }) },
  { caseId: 'OMH-054', label: 'post uses unreserved key', mutate: sources => Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, source.replace('idempotencyKey: key', 'idempotencyKey: input.idempotencyKey')])) },
]
for (const { caseId, label, mutate } of recoveryNegatives) {
  test(`recovery ${caseId} rejects ${label}`, () => {
    const root = stageTarget('src/fixture.ts', 'export {}')
    try {
      writeRecoverySources(root, mutate(recoveryFixtures[caseId]))
      const result = runOracle(root, 'before', process.env, caseId)
      assert.equal(result.status, 1, JSON.stringify(result.parsed))
      assert.equal(result.parsed.passed, false)
    } finally { fs.rmSync(root, { recursive: true, force: true }) }
  })
}


test('recovery OMH-014 bounds cycles, component count and rendered source bytes', () => {
  const root = stageTarget('src/fixture.ts', 'export {}')
  try {
    writeRecoverySources(root, {
      'src/modules/library/backend/books/page.tsx': "import { Books } from '../../components/Books'\nexport default function Page() { return <Books /> }",
      'src/modules/library/components/Books.tsx': "import { Loop } from './Loop'\nexport function Books() { return <Loop /> }",
      'src/modules/library/components/Loop.tsx': "import { Books } from './Books'\nexport function Loop() { return <Books /> }",
    })
    const assertGeneratedFailure = () => {
      const result = runOracle(root, 'before', process.env, 'OMH-014')
      assert.equal(result.status, 1, JSON.stringify(result.parsed))
      assert.equal(result.parsed.passed, false)
    }
    assertGeneratedFailure()
    writeRecoverySources(root, recoveryFixtures['OMH-014'])
    fs.appendFileSync(path.join(root, 'src/modules/library/components/Books.tsx'), '\n/*' + 'x'.repeat(512 * 1024) + '*/')
    assertGeneratedFailure()
    const parts = Array.from({ length: 64 }, (_, index) => `Part${index}`)
    writeRecoverySources(root, {
      ...recoveryFixtures['OMH-014'],
      'src/modules/library/backend/books/page.tsx': parts.map(name => `import { ${name} } from '../../components/${name}'`).join('\n') + "\nimport { Books } from '../../components/Books'\nexport default function Page() { return <><Books />" + parts.map(name => `<${name} />`).join('') + '</> }',
      ...Object.fromEntries(parts.map(name => [`src/modules/library/components/${name}.tsx`, `export function ${name}() { return <div /> }`])),
    })
    assertGeneratedFailure()
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test('recovery OMH-031 permits explicit metadata handoff when after consumes it', () => {
  const root = stageTarget('src/fixture.ts', 'export {}')
  try {
    writeRecoverySources(root, Object.fromEntries(Object.entries(recoveryFixtures['OMH-031']).map(([file, source]) => [file, source.replace('return { ok: true, query:', 'return { ok: true, metadata: { approved: true }, query:').replace(/}\s*\]$/, ', async after(request, response, context) { return { merge: { approved: context.metadata?.approved } } } }]') ])))
    assert.equal(runOracle(root, 'before', process.env, 'OMH-031').parsed.passed, true)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})


test('recovery OMH-014 malformed generated graph remains a case failure and still runs after typecheck', { skip: !targetSandboxAvailable }, () => {
  const root = stageTarget('src/fixture.ts', 'export {}')
  try {
    writeRecoverySources(root, {
      ...recoveryFixtures['OMH-014'],
      'src/modules/library/backend/books/page.tsx': "import { Books } from '../../components/Missing'\nexport default function Page() { return <Books /> }",
    })
    const bin = installFakeYarn(root)
    const result = runOracle(root, 'after', { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH ?? ''}` }, 'OMH-014')
    assert.equal(result.status, 1, JSON.stringify(result.parsed))
    assert.equal(result.parsed.checks.find(entry => entry.id === 'ui.rendered-source')?.passed, false)
    assert.ok(result.parsed.checks.some(entry => entry.id === 'target.typecheck'))
    assert.ok(fs.existsSync(path.join(root, 'typecheck-invocation.txt')))
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
