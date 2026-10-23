import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import {
  catalogLineFor,
  DEFAULT_PICKER_URL,
  fetchPickerCatalog,
  installCommandFor,
  modulesWithoutLineInstall,
  parsePickerIndex,
  resolvePickerUrl,
  selectableModules,
  type CatalogFetch,
  type CatalogResponse,
} from './fetch-catalog.js'
import {
  buildSelectionFile,
  CATALOG_SELECTION_FILE,
  installCommands,
  parseModulesFlag,
  resolveCatalogSelection,
} from './selection.js'
import { parsePickerAnswer, runCatalogStep, type CatalogStepOptions } from './catalog-step.js'
import type { PickerIndex } from './types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = (): unknown => JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'picker.json'), 'utf8'))
const index = parsePickerIndex(fixture()) as PickerIndex
const KSEF_NEXT = 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.7 --allow-third-party'

/** The fixture with ksef verified on `next` in an older version than on the latest line. */
function fixtureWithNextVersion(): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  for (const entry of body.modules) {
    if (entry.id === 'integration_ksef_direct') {
      entry.installByLine = { ...(entry.installByLine as Record<string, string>), next: KSEF_NEXT }
    }
  }
  return body
}

/** picker.json as published before `installByLine`: only the latest-line `install`. */
function fixtureWithoutInstallByLine(): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  for (const entry of body.modules) delete entry.installByLine
  return body
}

function response(status: number, body: unknown): CatalogResponse {
  return { status, ok: status >= 200 && status < 300, json: async () => body }
}

function fakeFetch(plan: ('ok' | 'error' | 'timeout' | 404 | 503 | 'garbage')[], body: () => unknown = fixture) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const fetchImpl: CatalogFetch = async (url, init) => {
    calls.push({ url, headers: init.headers })
    const step = plan[Math.min(calls.length - 1, plan.length - 1)]
    if (step === 'error') throw new Error('getaddrinfo ENOTFOUND modules.openmercato.com')
    if (step === 'timeout') throw new Error('The operation was aborted due to timeout')
    if (step === 404 || step === 503) return response(step, null)
    if (step === 'garbage') return response(200, { schemaVersion: 2 })
    return response(200, body())
  }
  return { fetchImpl, calls }
}

function stepOptions(overrides: Partial<CatalogStepOptions> = {}) {
  const logs: string[] = []
  const warnings: string[] = []
  const options: CatalogStepOptions = {
    targetDir: mkdtempSync(join(tmpdir(), 'om-catalog-step-')),
    version: '0.9.0',
    requested: null,
    picker: false,
    presetModuleIds: ['auth', 'directory', 'integrations'],
    ask: null,
    log: (line) => logs.push(line),
    warn: (line) => warnings.push(line),
    env: {},
    fetchImpl: fakeFetch(['ok']).fetchImpl,
    ...overrides,
  }
  return { options, logs, warnings }
}

test('parsePickerIndex reads the published picker.json and drops malformed modules', () => {
  assert.equal(index.schemaVersion, 1)
  assert.deepEqual(index.lines, ['0.9', '0.8', 'next'])
  assert.equal(index.modules.length, 14)
  assert.deepEqual(index.modules.find((entry) => entry.id === 'integration_ksef_direct')?.installByLine, {
    '0.9': 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
    next: 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
  })
  const broken = { ...(fixture() as Record<string, unknown>), modules: [{ id: 'x' }, ...index.modules] }
  assert.equal(parsePickerIndex(broken)?.modules.length, 14)
  assert.equal(parsePickerIndex({ schemaVersion: 2 }), null)
  assert.equal(parsePickerIndex(null), null)
})

test('catalogLineFor maps create-mercato-app versions to catalog lines', () => {
  assert.equal(catalogLineFor('0.9.0', index.lines), '0.9')
  assert.equal(catalogLineFor('0.8.3', index.lines), '0.8')
  assert.equal(catalogLineFor('0.10.1-develop.7583.1.0c886d0a14', index.lines), 'next')
  assert.equal(catalogLineFor('0.10.0', index.lines), null)
  assert.equal(catalogLineFor('not-a-version', index.lines), null)
})

test('selectableModules offers only non-core modules verified on the line', () => {
  assert.deepEqual(
    selectableModules(index, '0.9').map((entry) => entry.id),
    ['integration_ksef_direct', 'durable_work', 'gateway_stripe'],
  )
  assert.deepEqual(selectableModules(index, 'next').map((entry) => entry.id), ['integration_ksef_direct'])
  assert.deepEqual(selectableModules(index, null), [])
})

test('installCommandFor pins the version verified on the line of the app', () => {
  const withNext = parsePickerIndex(fixtureWithNextVersion()) as PickerIndex
  const ksef = withNext.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.equal(installCommandFor(ksef, '0.9', withNext.lines), 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party')
  assert.equal(installCommandFor(ksef, 'next', withNext.lines), KSEF_NEXT)
  assert.equal(installCommandFor(ksef, '0.8', withNext.lines), null)
  assert.deepEqual(
    selectableModules(withNext, 'next').map((entry) => entry.install),
    [KSEF_NEXT],
  )
})

test('without installByLine only the latest line gets the catalog install command', () => {
  const legacy = parsePickerIndex(fixtureWithoutInstallByLine()) as PickerIndex
  const ksef = legacy.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.equal(ksef.installByLine, null)
  assert.equal(installCommandFor(ksef, '0.9', legacy.lines), ksef.install)
  assert.equal(installCommandFor(ksef, 'next', legacy.lines), null)
  assert.deepEqual(selectableModules(legacy, '0.9').map((entry) => entry.id), ['integration_ksef_direct', 'durable_work', 'gateway_stripe'])
  assert.deepEqual(selectableModules(legacy, 'next'), [])
  assert.deepEqual(modulesWithoutLineInstall(legacy, 'next').map((entry) => entry.id), ['integration_ksef_direct'])
  assert.deepEqual(modulesWithoutLineInstall(legacy, '0.9'), [])
})

test('resolvePickerUrl defaults to modules.openmercato.com and honours OM_MODULES_PICKER_URL', () => {
  assert.equal(DEFAULT_PICKER_URL, 'https://modules.openmercato.com/picker.json')
  assert.equal(resolvePickerUrl({}), DEFAULT_PICKER_URL)
  assert.equal(resolvePickerUrl({ OM_MODULES_PICKER_URL: ' https://mirror.example.com/picker.json ' }), 'https://mirror.example.com/picker.json')
})

test('fetchPickerCatalog retries once after a network error or a 5xx', async () => {
  const flaky = fakeFetch(['error', 'ok'])
  const result = await fetchPickerCatalog({ fetchImpl: flaky.fetchImpl })
  assert.equal(result.status, 'ok')
  assert.equal(flaky.calls.length, 2)
  assert.equal(flaky.calls[0]?.url, DEFAULT_PICKER_URL)

  const busy = fakeFetch([503, 'ok'])
  assert.equal((await fetchPickerCatalog({ fetchImpl: busy.fetchImpl })).status, 'ok')
})

test('fetchPickerCatalog reports unavailable after two failures, a 404 or an unknown format', async () => {
  const offline = fakeFetch(['timeout'])
  const result = await fetchPickerCatalog({ fetchImpl: offline.fetchImpl })
  assert.deepEqual(result, {
    status: 'unavailable',
    url: DEFAULT_PICKER_URL,
    reason: 'The operation was aborted due to timeout',
  })
  assert.equal(offline.calls.length, 2)

  const missing = fakeFetch([404])
  assert.deepEqual(await fetchPickerCatalog({ fetchImpl: missing.fetchImpl }), {
    status: 'unavailable',
    url: DEFAULT_PICKER_URL,
    reason: 'HTTP 404',
  })
  assert.equal(missing.calls.length, 1)

  const garbage = fakeFetch(['garbage'])
  assert.equal((await fetchPickerCatalog({ fetchImpl: garbage.fetchImpl })).status, 'unavailable')
})

test('fetchPickerCatalog gives up after the timeout of a hanging request', async () => {
  const hanging: CatalogFetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  const started = Date.now()
  const result = await fetchPickerCatalog({ fetchImpl: hanging, timeoutMs: 50 })
  assert.equal(result.status, 'unavailable')
  assert.ok(Date.now() - started < 2000)
})

test('parseModulesFlag splits, trims and dedupes', () => {
  assert.deepEqual(parseModulesFlag(' gateway_stripe, @fastwhitecat/integration-ksef-direct ,,gateway_stripe'), [
    'gateway_stripe',
    '@fastwhitecat/integration-ksef-direct',
  ])
})

test('resolveCatalogSelection matches ids, npm names and locators and reports the rest', () => {
  const selectable = selectableModules(index, '0.9')
  const selection = resolveCatalogSelection(
    ['gateway_stripe', '@fastwhitecat/integration-ksef-direct', 'npm:@fullstackhouse/open-mercato-durable-work', 'gateway_tpay', 'nope'],
    selectable,
    ['auth'],
  )
  assert.deepEqual(
    selection.selected.map(({ entry, reason }) => [entry.id, reason]),
    [
      ['gateway_stripe', 'requested'],
      ['integration_ksef_direct', 'requested'],
      ['durable_work', 'requested'],
    ],
  )
  assert.deepEqual(selection.unknown, ['gateway_tpay', 'nope'])
  assert.deepEqual(selection.unmetRequires, [{ id: 'integration_ksef_direct', requires: 'integrations' }])
  assert.deepEqual(installCommands(selection), [
    'yarn mercato module add @open-mercato/gateway-stripe@0.9.0',
    'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
    'yarn mercato module add @fullstackhouse/open-mercato-durable-work@0.6.0 --allow-third-party',
  ])
})

test('resolveCatalogSelection pulls in required catalog modules first', () => {
  const dependent = {
    ...index.modules.find((entry) => entry.id === 'data_sync' && entry.source === 'third-party')!,
    verifiedOn: ['0.9'],
  }
  const selectable = [...selectableModules(index, '0.9'), dependent]
  const selection = resolveCatalogSelection(['@fullstackhouse/open-mercato-data-sync-durable'], selectable, null)
  assert.deepEqual(
    selection.selected.map(({ entry, reason }) => [entry.id, reason]),
    [
      ['durable_work', 'required'],
      ['data_sync', 'requested'],
    ],
  )
  assert.deepEqual(selection.unmetRequires, [])
})

test('resolveCatalogSelection treats an unknown preset as satisfying core requirements', () => {
  const selection = resolveCatalogSelection(['integration_ksef_direct'], selectableModules(index, '0.9'), null)
  assert.deepEqual(selection.unmetRequires, [])
})

test('buildSelectionFile records the plan with licenses, levels and commands', () => {
  const selection = resolveCatalogSelection(['integration_ksef_direct'], selectableModules(index, '0.9'), null)
  const file = buildSelectionFile(DEFAULT_PICKER_URL, index, '0.9', selection)
  assert.deepEqual(file, {
    schemaVersion: 1,
    catalog: DEFAULT_PICKER_URL,
    catalogGeneratedAt: '2026-10-23T03:05:00Z',
    line: '0.9',
    modules: [
      {
        id: 'integration_ksef_direct',
        from: '@fastwhitecat/integration-ksef-direct',
        locator: 'npm:@fastwhitecat/integration-ksef-direct',
        source: 'third-party',
        license: { spdx: 'MIT', kind: 'osi' },
        tier: 'verified',
        install: 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
        reason: 'requested',
      },
    ],
    commands: ['yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party'],
  })
})

test('parsePickerAnswer accepts numbers separated by commas or spaces', () => {
  assert.deepEqual(parsePickerAnswer('', 3), [])
  assert.deepEqual(parsePickerAnswer('1, 3 3', 3), [1, 3])
  assert.throws(() => parsePickerAnswer('4', 3), /4 is not on the list \(1-3\)/)
  assert.throws(() => parsePickerAnswer('x', 3), /"x" is not a number from the list/)
})

test('runCatalogStep with --modules writes .mercato/catalog-selection.json and returns the commands', async () => {
  const { options, logs, warnings } = stepOptions({ requested: ['gateway_stripe', 'integration_ksef_direct'] })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [
    'yarn mercato module add @open-mercato/gateway-stripe@0.9.0',
    'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
  ])
  assert.equal(result.selectionFile, join(options.targetDir, CATALOG_SELECTION_FILE))
  const saved = JSON.parse(readFileSync(join(options.targetDir, CATALOG_SELECTION_FILE), 'utf8'))
  assert.equal(saved.line, '0.9')
  assert.equal(saved.modules.length, 2)
  assert.deepEqual(warnings, [])
  assert.ok(logs.some((line) => line.includes('integration_ksef_direct from @fastwhitecat/integration-ksef-direct (third-party · MIT · verified on 0.9)')))
  assert.ok(logs.some((line) => line.includes('--allow-third-party')))
})

test('runCatalogStep on a develop build installs the version verified on next', async () => {
  const { options, warnings } = stepOptions({
    version: '0.10.1-develop.7583.1.0c886d0a14',
    requested: ['integration_ksef_direct'],
    presetModuleIds: null,
    fetchImpl: fakeFetch(['ok'], fixtureWithNextVersion).fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [KSEF_NEXT])
  const saved = JSON.parse(readFileSync(result.selectionFile ?? '', 'utf8'))
  assert.equal(saved.line, 'next')
  assert.equal(saved.modules[0].install, KSEF_NEXT)
  assert.deepEqual(warnings, [])
})

test('runCatalogStep leaves out a module without an install command for a line other than latest', async () => {
  const fetchImpl = fakeFetch(['ok'], fixtureWithoutInstallByLine).fetchImpl
  const requested = stepOptions({
    version: '0.10.1-develop.7583.1.0c886d0a14',
    requested: ['integration_ksef_direct'],
    presetModuleIds: null,
    fetchImpl,
  })
  assert.deepEqual(await runCatalogStep(requested.options), { commands: [], selectionFile: null })
  assert.deepEqual(requested.warnings, [
    'integration_ksef_direct is verified on next, but the module catalog gives no install command for next yet. Add it later from https://modules.openmercato.com.',
  ])

  const picker = stepOptions({
    version: '0.10.1-develop.7583.1.0c886d0a14',
    picker: true,
    ask: async () => {
      throw new Error('the picker must not ask without modules to offer')
    },
    fetchImpl,
  })
  assert.deepEqual(await runCatalogStep(picker.options), { commands: [], selectionFile: null })
  assert.deepEqual(picker.warnings, [
    'Left out of the list: integration_ksef_direct. The module catalog verifies them on next but gives no install command for next yet.',
  ])
})

test('runCatalogStep never blocks scaffolding when the catalog is offline', async () => {
  const { options, warnings } = stepOptions({
    requested: ['gateway_stripe'],
    fetchImpl: fakeFetch(['error']).fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result, { commands: [], selectionFile: null })
  assert.equal(existsSync(join(options.targetDir, CATALOG_SELECTION_FILE)), false)
  assert.match(warnings[0] ?? '', /^Module catalog unavailable \(getaddrinfo ENOTFOUND modules\.openmercato\.com\)\. The app keeps its preset modules/)
})

test('runCatalogStep offers nothing for a version the catalog does not verify', async () => {
  const { options, warnings } = stepOptions({ requested: ['gateway_stripe'], version: '0.10.0' })
  assert.deepEqual(await runCatalogStep(options), { commands: [], selectionFile: null })
  assert.match(warnings[0] ?? '', /does not verify modules for Open Mercato 0\.10\.0 yet/)
})

test('runCatalogStep warns about unknown modules and unmet core requirements', async () => {
  const { options, warnings } = stepOptions({ requested: ['integration_ksef_direct', 'gateway_tpay'], presetModuleIds: ['auth'] })
  const result = await runCatalogStep(options)
  assert.equal(result.commands.length, 1)
  assert.ok(warnings.some((line) => line.startsWith('Not verified on 0.9 in the module catalog: gateway_tpay.')))
  assert.ok(
    warnings.some((line) =>
      line.includes('integration_ksef_direct requires integrations, which the preset does not enable: yarn mercato module enable @open-mercato/core --module integrations'),
    ),
  )
})

test('runCatalogStep points core module ids to module enable instead of a package', async () => {
  const { options, logs, warnings } = stepOptions({ requested: ['wms', 'currencies'], presetModuleIds: ['auth', 'currencies'] })
  assert.deepEqual(await runCatalogStep(options), { commands: [], selectionFile: null })
  assert.ok(warnings.includes('wms is built into Open Mercato core, not a package: yarn mercato module enable @open-mercato/core --module wms'))
  assert.ok(logs.includes('currencies is built into Open Mercato core and the preset already enables it.'))
})

test('runCatalogStep runs the interactive picker with the license and level of every module', async () => {
  const questions: string[] = []
  const answers = ['9', '3']
  const { options, logs, warnings } = stepOptions({
    picker: true,
    ask: async (question) => {
      questions.push(question)
      return answers.shift() ?? ''
    },
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, ['yarn mercato module add @open-mercato/gateway-stripe@0.9.0'])
  assert.equal(questions.length, 2)
  assert.ok(warnings.some((line) => line.includes('9 is not on the list (1-3).')))
  assert.ok(logs.some((line) => line.includes('1. integration_ksef_direct  KSeF Integration  (third-party · MIT · verified on 0.9)')))
  assert.ok(logs.some((line) => line.includes('3. gateway_stripe')))
})

test('runCatalogStep skips the picker without a terminal and keeps --modules', async () => {
  const { options, warnings } = stepOptions({ picker: true, ask: null, requested: ['durable_work'] })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, ['yarn mercato module add @fullstackhouse/open-mercato-durable-work@0.6.0 --allow-third-party'])
  assert.ok(warnings.includes('--module-picker needs an interactive terminal; skipped. Use --modules <list> instead.'))
})

test('runCatalogStep reads the picker URL from OM_MODULES_PICKER_URL', async () => {
  const mirror = fakeFetch(['ok'])
  const { options } = stepOptions({
    requested: ['gateway_stripe'],
    env: { OM_MODULES_PICKER_URL: 'https://mirror.example.com/picker.json' },
    fetchImpl: mirror.fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.equal(mirror.calls[0]?.url, 'https://mirror.example.com/picker.json')
  const saved = JSON.parse(readFileSync(result.selectionFile ?? '', 'utf8'))
  assert.equal(saved.catalog, 'https://mirror.example.com/picker.json')
})
