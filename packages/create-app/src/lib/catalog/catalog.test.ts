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
import {
  closestCatalogName,
  collisionWarning,
  parsePickerAnswer,
  runCatalogStep,
  type CatalogStepOptions,
} from './catalog-step.js'
import type { PickerIndex } from './types.js'
import { resolvePreset } from '../apply-starter-preset.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixture = (): unknown => JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'picker.json'), 'utf8'))
const index = parsePickerIndex(fixture()) as PickerIndex
const KSEF_NEXT = 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.7 --allow-third-party'
const DURABLE_SYNC = 'yarn mercato module add @fullstackhouse/open-mercato-data-sync-durable@0.6.0 --allow-third-party'

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

const WORK_B = 'yarn mercato module add @publisher-b/work@1.0.0 --allow-third-party'
const WORK_A = 'yarn mercato module add @fullstackhouse/open-mercato-durable-work@0.6.0 --allow-third-party'

/**
 * The fixture with a second package that publishes the module id durable_work, as two community packages may, and
 * with the durable data_sync verified on 0.9 and requiring durable_work by id.
 */
function fixtureWithSharedId(): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  const work = body.modules.find((entry) => entry.id === 'durable_work') as Record<string, unknown>
  body.modules.push({
    ...work,
    from: '@publisher-b/work',
    locator: 'npm:@publisher-b/work',
    title: 'Durable Work B',
    install: WORK_B,
    installByLine: { '0.9': WORK_B },
  })
  const sync = body.modules.find((entry) => entry.id === 'data_sync' && entry.source === 'third-party') as Record<string, unknown>
  Object.assign(sync, {
    requires: ['durable_work'],
    verifiedOn: ['0.9'],
    installByLine: { '0.9': sync.install as string },
  })
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
  assert.equal(index.modules.length, 15)
  assert.deepEqual(index.modules.find((entry) => entry.id === 'integration_ksef_direct')?.installByLine, {
    '0.9': 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
    next: 'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
  })
  const broken = { ...(fixture() as Record<string, unknown>), modules: [{ id: 'x' }, ...index.modules] }
  assert.equal(parsePickerIndex(broken)?.modules.length, 15)
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
    ['integration_ksef_direct', 'data_sync', 'durable_work', 'gateway_stripe'],
  )
  assert.deepEqual(selectableModules(index, 'next').map((entry) => entry.id), ['integration_ksef_direct', 'data_sync'])
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
    [KSEF_NEXT, DURABLE_SYNC],
  )
})

test('without installByLine only the latest line gets the catalog install command', () => {
  const legacy = parsePickerIndex(fixtureWithoutInstallByLine()) as PickerIndex
  const ksef = legacy.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.equal(ksef.installByLine, null)
  assert.equal(installCommandFor(ksef, '0.9', legacy.lines), ksef.install)
  assert.equal(installCommandFor(ksef, 'next', legacy.lines), null)
  assert.deepEqual(selectableModules(legacy, '0.9').map((entry) => entry.id), ['integration_ksef_direct', 'data_sync', 'durable_work', 'gateway_stripe'])
  assert.deepEqual(selectableModules(legacy, 'next'), [])
  assert.deepEqual(modulesWithoutLineInstall(legacy, 'next').map((entry) => entry.id), ['integration_ksef_direct', 'data_sync'])
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
  assert.deepEqual(result.commandWarnings, {})
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
  assert.deepEqual(await runCatalogStep(requested.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(requested.warnings, [
    'integration_ksef_direct is verified on next, but the module catalog gives no install command for next. Add it later from https://modules.openmercato.com.',
  ])

  const picker = stepOptions({
    version: '0.10.1-develop.7583.1.0c886d0a14',
    picker: true,
    ask: async () => {
      throw new Error('the picker must not ask without modules to offer')
    },
    fetchImpl,
  })
  assert.deepEqual(await runCatalogStep(picker.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(picker.warnings, [
    'Left out of the list: integration_ksef_direct, data_sync. The module catalog verifies them on next but gives no install command for next.',
  ])
})

test('runCatalogStep never blocks scaffolding when the catalog is offline', async () => {
  const { options, warnings } = stepOptions({
    requested: ['gateway_stripe'],
    fetchImpl: fakeFetch(['error']).fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result, { commands: [], selectionFile: null, commandWarnings: {} })
  assert.equal(existsSync(join(options.targetDir, CATALOG_SELECTION_FILE)), false)
  assert.match(warnings[0] ?? '', /^Module catalog unavailable \(getaddrinfo ENOTFOUND modules\.openmercato\.com\)\. The app keeps its preset modules/)
})

test('runCatalogStep offers nothing for a version the catalog does not verify', async () => {
  const { options, warnings } = stepOptions({ requested: ['gateway_stripe'], version: '0.10.0' })
  assert.deepEqual(await runCatalogStep(options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.match(warnings[0] ?? '', /does not verify modules for Open Mercato 0\.10\.0 yet/)
})

test('runCatalogStep warns about unknown modules and unmet core requirements', async () => {
  const { options, warnings } = stepOptions({ requested: ['integration_ksef_direct', 'gateway_tpay'], presetModuleIds: ['auth'] })
  const result = await runCatalogStep(options)
  assert.equal(result.commands.length, 1)
  assert.ok(warnings.some((line) => line.startsWith('Not verified on 0.9: gateway_tpay is in the module catalog, but the catalog has not verified it on 0.9.')))
  assert.ok(
    warnings.some((line) =>
      line.includes('integration_ksef_direct requires integrations, which the preset does not enable: yarn mercato module enable @open-mercato/core --module integrations'),
    ),
  )
})

test('runCatalogStep points core module ids to module enable instead of a package', async () => {
  const { options, logs, warnings } = stepOptions({ requested: ['wms', 'currencies'], presetModuleIds: ['auth', 'currencies'] })
  assert.deepEqual(await runCatalogStep(options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.ok(warnings.includes('wms is built into Open Mercato core, not a package: yarn mercato module enable @open-mercato/core --module wms'))
  assert.ok(logs.includes('currencies is built into Open Mercato core and the preset already enables it.'))
})

test('runCatalogStep runs the interactive picker with the license and level of every module', async () => {
  const questions: string[] = []
  const answers = ['9', '4']
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
  assert.ok(warnings.some((line) => line.includes('9 is not on the list (1-4).')))
  assert.ok(logs.some((line) => line.includes('1. integration_ksef_direct  KSeF Integration  (third-party · MIT · verified on 0.9)')))
  assert.ok(logs.some((line) => line.includes('4. gateway_stripe')))
  assert.ok(!warnings.some((line) => line.includes('Warning:')))
})

test('runCatalogStep installs the package picked, not another package with the same module id', async () => {
  const { options, logs, warnings } = stepOptions({
    picker: true,
    ask: async () => '5',
    fetchImpl: fakeFetch(['ok'], fixtureWithSharedId).fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [WORK_B])
  assert.ok(logs.some((line) => line.includes('3. durable_work             Durable Work  (@fullstackhouse/open-mercato-durable-work · third-party')))
  assert.ok(logs.some((line) => line.includes('5. durable_work             Durable Work B  (@publisher-b/work · third-party')))
  assert.ok(logs.some((line) => line.includes('4. gateway_stripe           Stripe Payment Gateway  (official · MIT')), 'a module id of its own shows no package')
  assert.ok(logs.some((line) => line.includes('durable_work from @publisher-b/work')))
  const saved = JSON.parse(readFileSync(result.selectionFile ?? '', 'utf8'))
  assert.deepEqual(saved.modules.map((entry: { from: string }) => entry.from), ['@publisher-b/work'])
  assert.deepEqual(warnings, [])
})

test('runCatalogStep reports a module id two packages share and resolves their npm names', async () => {
  const shared = fakeFetch(['ok'], fixtureWithSharedId).fetchImpl
  const byId = stepOptions({ requested: ['durable_work'], fetchImpl: shared })
  assert.deepEqual(await runCatalogStep(byId.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(byId.warnings, [
    '"durable_work" matches several modules (durable_work from @fullstackhouse/open-mercato-durable-work, durable_work from @publisher-b/work), so none is planned. Pass one of these to --modules instead: @fullstackhouse/open-mercato-durable-work, @publisher-b/work.',
  ])
  const byName = stepOptions({ requested: ['@publisher-b/work'], fetchImpl: shared })
  assert.deepEqual((await runCatalogStep(byName.options)).commands, [WORK_B])
  assert.deepEqual((await runCatalogStep(stepOptions({ requested: ['npm:@fullstackhouse/open-mercato-durable-work'], fetchImpl: shared }).options)).commands, [WORK_A])
  const enterprise = resolveCatalogSelection(['@open-mercato/enterprise'], index.modules.filter((entry) => entry.from === '@open-mercato/enterprise'), null)
  assert.deepEqual(enterprise.ambiguous[0]?.picks, ['agent_orchestrator', 'record_locks', 'security', 'sso', 'system_status_overlays'], 'modules of one package are told apart by module id')
})

/**
 * Two community packages that publish durable_work, one of them with a second module: @publisher-a/work has
 * durable_work and other_mod, @publisher-b/work has durable_work only.
 */
function fixtureWithSharedIdInMultiModulePackage(): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  const work = body.modules.find((entry) => entry.id === 'durable_work') as Record<string, unknown>
  const publisher = (from: string, id: string, title: string) => {
    const install = `yarn mercato module add ${from}@1.0.0 --module ${id} --allow-third-party`
    return { ...work, id, from, locator: `npm:${from}`, title, install, installByLine: { '0.9': install } }
  }
  body.modules = body.modules.filter((entry) => entry !== work)
  body.modules.push(
    publisher('@publisher-a/work', 'durable_work', 'Durable Work A'),
    publisher('@publisher-a/work', 'other_mod', 'Other Module A'),
    publisher('@publisher-b/work', 'durable_work', 'Durable Work B'),
  )
  return body
}

test('runCatalogStep gives advice that ends when a shared module id lives in a package with several modules', async () => {
  const shared = fakeFetch(['ok'], fixtureWithSharedIdInMultiModulePackage).fetchImpl
  const A_WORK = 'yarn mercato module add @publisher-a/work@1.0.0 --module durable_work --allow-third-party'
  const A_OTHER = 'yarn mercato module add @publisher-a/work@1.0.0 --module other_mod --allow-third-party'
  const B_WORK = 'yarn mercato module add @publisher-b/work@1.0.0 --module durable_work --allow-third-party'
  const run = async (requested: string[]) => {
    const step = stepOptions({ requested, fetchImpl: shared })
    return { ...(await runCatalogStep(step.options)), warnings: step.warnings }
  }

  const byId = await run(['durable_work'])
  assert.deepEqual(byId.commands, [])
  assert.deepEqual(byId.warnings, [
    '"durable_work" matches several modules (durable_work from @publisher-a/work, durable_work from @publisher-b/work), so none is planned. Pass one of these to --modules instead: @publisher-a/work:durable_work, @publisher-b/work.',
  ])
  const byPackage = await run(['@publisher-a/work'])
  assert.deepEqual(byPackage.commands, [])
  assert.deepEqual(byPackage.warnings, [
    '"@publisher-a/work" matches several modules (durable_work, other_mod), so none is planned. Pass one of these to --modules instead: @publisher-a/work:durable_work, other_mod.',
  ])

  // Following the advice from any ambiguous item plans exactly one module, so it never sends the user back.
  const selectable = selectableModules(parsePickerIndex(fixtureWithSharedIdInMultiModulePackage()) as PickerIndex, '0.9')
  const followed = new Set<string>()
  const queue = ['durable_work', '@publisher-a/work', '@publisher-b/work']
  const planned: Record<string, string[]> = {}
  while (queue.length > 0) {
    const request = queue.shift() as string
    if (followed.has(request)) continue
    followed.add(request)
    assert.ok(followed.size <= 10, 'the advice keeps pointing at new items')
    const selection = resolveCatalogSelection([request], selectable, null)
    for (const item of selection.ambiguous) queue.push(...item.picks)
    if (selection.ambiguous.length === 0) planned[request] = (await run([request])).commands
  }
  assert.deepEqual(planned, {
    '@publisher-b/work': [B_WORK],
    '@publisher-a/work:durable_work': [A_WORK],
    other_mod: [A_OTHER],
  })
  assert.deepEqual((await run(['npm:@publisher-a/work:durable_work'])).commands, [A_WORK])
  assert.deepEqual((await run(['@Publisher-A/work:DURABLE_WORK'])).commands, [A_WORK])
  const missing = await run(['@publisher-a/work:nope'])
  assert.deepEqual(missing.commands, [])
  assert.equal(missing.warnings.length, 1)
  assert.match(missing.warnings[0] as string, /^Not in the module catalog: @publisher-a\/work:nope\./)
})

test('runCatalogStep plans the package picked in the picker when a shared module id lives in a package with several modules', async () => {
  const { options, logs, warnings } = stepOptions({
    picker: true,
    ask: async () => {
      const row = logs.find((line) => line.includes('Durable Work A')) ?? ''
      return /^\s*(\d+)\./.exec(row)?.[1] ?? ''
    },
    fetchImpl: fakeFetch(['ok'], fixtureWithSharedIdInMultiModulePackage).fetchImpl,
  })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, ['yarn mercato module add @publisher-a/work@1.0.0 --module durable_work --allow-third-party'])
  assert.ok(logs.some((line) => /durable_work +Durable Work A {2}\(@publisher-a\/work · third-party/.test(line)))
  assert.deepEqual(warnings, [])
})

test('runCatalogStep plans a requirement two packages provide only from the package asked for', async () => {
  const shared = fakeFetch(['ok'], fixtureWithSharedId).fetchImpl
  const SYNC = 'yarn mercato module add @fullstackhouse/open-mercato-data-sync-durable@0.6.0 --allow-third-party'
  const alone = stepOptions({ requested: ['@fullstackhouse/open-mercato-data-sync-durable'], fetchImpl: shared })
  assert.deepEqual((await runCatalogStep(alone.options)).commands, [SYNC], 'neither provider is guessed')
  assert.deepEqual(alone.warnings, [
    'data_sync requires durable_work, which several catalog modules provide (durable_work from @fullstackhouse/open-mercato-durable-work, durable_work from @publisher-b/work), so none is planned. Add the one you want to --modules as one of: @fullstackhouse/open-mercato-durable-work, @publisher-b/work.',
  ])
  const chosen = stepOptions({ requested: ['@fullstackhouse/open-mercato-data-sync-durable', '@publisher-b/work'], fetchImpl: shared })
  assert.deepEqual((await runCatalogStep(chosen.options)).commands, [WORK_B, SYNC])
  assert.deepEqual(chosen.warnings, [])
})

test('runCatalogStep skips the picker without a terminal and keeps --modules', async () => {
  const { options, warnings } = stepOptions({ picker: true, ask: null, requested: ['durable_work'] })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, ['yarn mercato module add @fullstackhouse/open-mercato-durable-work@0.6.0 --allow-third-party'])
  assert.ok(warnings.includes('--module-picker needs an interactive terminal; skipped. Use --modules <list> instead.'))
})

test('runCatalogStep fetches nothing when there is nothing to plan', async () => {
  const noTerminal = fakeFetch(['ok'])
  const picker = stepOptions({ picker: true, ask: null, fetchImpl: noTerminal.fetchImpl })
  assert.deepEqual(await runCatalogStep(picker.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(picker.warnings, ['--module-picker needs an interactive terminal; skipped. Use --modules <list> instead.'])
  const emptyList = fakeFetch(['ok'])
  const modules = stepOptions({ requested: [], fetchImpl: emptyList.fetchImpl })
  assert.deepEqual(await runCatalogStep(modules.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(modules.warnings, [])
  assert.equal(noTerminal.calls.length + emptyList.calls.length, 0)
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

test('parsePickerIndex reads inPresets and presetNote, and older files without them', () => {
  const stripe = index.modules.find((entry) => entry.id === 'gateway_stripe')!
  assert.deepEqual(stripe.inPresets, ['0.8', '0.9', 'next'])
  assert.equal(stripe.presetNote, 'Nothing to install: a new app already registers gateway_stripe in src/modules.ts.')
  const ksef = index.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.deepEqual(ksef.inPresets, [])
  assert.equal(ksef.presetNote, null)
})

test('runCatalogStep plans nothing for a module a new classic app already registers', async () => {
  const { options, logs, warnings } = stepOptions({ requested: ['gateway_stripe', 'integration_ksef_direct'], presetModuleIds: null })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, ['yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party'])
  const saved = JSON.parse(readFileSync(result.selectionFile ?? '', 'utf8'))
  assert.deepEqual(saved.modules.map((entry: { id: string }) => entry.id), ['integration_ksef_direct'])
  assert.deepEqual(warnings, [])
  assert.ok(logs.includes('Nothing to install: a new app already registers gateway_stripe in src/modules.ts.'))
  assert.ok(!logs.some((line) => line.includes('gateway-stripe@')))

  const only = stepOptions({ requested: ['@open-mercato/gateway-stripe'], presetModuleIds: null })
  assert.deepEqual(await runCatalogStep(only.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.equal(existsSync(join(only.options.targetDir, CATALOG_SELECTION_FILE)), false)
  assert.deepEqual(only.warnings, [])
})

test('runCatalogStep checks a preset other than classic against its own module list', async () => {
  const registers = stepOptions({
    requested: ['gateway_stripe'],
    presetModuleIds: ['auth', 'gateway_stripe'],
    presetModules: [
      { id: 'auth', from: '@open-mercato/core' },
      { id: 'gateway_stripe', from: '@open-mercato/gateway-stripe' },
    ],
  })
  assert.deepEqual(await runCatalogStep(registers.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.ok(registers.logs.includes('Nothing to install: the preset already registers gateway_stripe in src/modules.ts.'))

  const lacks = stepOptions({
    requested: ['gateway_stripe'],
    presetModuleIds: ['auth'],
    presetModules: [{ id: 'auth', from: '@open-mercato/core' }],
  })
  assert.deepEqual((await runCatalogStep(lacks.options)).commands, ['yarn mercato module add @open-mercato/gateway-stripe@0.9.0'])
})

test('runCatalogStep leaves modules a new classic app has out of the picker', async () => {
  const { options, logs } = stepOptions({ picker: true, presetModuleIds: null, ask: async () => '' })
  await runCatalogStep(options)
  assert.ok(logs.some((line) => line.includes('1. integration_ksef_direct')))
  assert.ok(logs.some((line) => line.includes('2. data_sync')))
  assert.ok(logs.some((line) => line.includes('3. durable_work')))
  assert.ok(!logs.some((line) => line.includes('gateway_stripe')))
  assert.ok(logs.includes('   Not listed: 1 catalog module the app already registers in src/modules.ts.'))
})

test('runCatalogStep tells a name the catalog lacks from a module it lists but has not verified', async () => {
  const { options, warnings } = stepOptions({
    requested: ['ksef_direct', 'nonexistent-x', '@piotrkarwatka/marketing-consents'],
    presetModuleIds: null,
  })
  assert.deepEqual(await runCatalogStep(options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.deepEqual(warnings, [
    'Not in the module catalog: ksef_direct. Did you mean integration_ksef_direct?',
    'Not in the module catalog: nonexistent-x. Search https://modules.openmercato.com for modules.',
    'Not verified on 0.9: @piotrkarwatka/marketing-consents is in the module catalog, but the catalog has not verified it on 0.9. Check its page on https://modules.openmercato.com or pick an alternative there.',
  ])
})

test('closestCatalogName suggests a near module ID or npm name, and nothing for a far one', () => {
  assert.equal(closestCatalogName('ksef_direct', index.modules), 'integration_ksef_direct')
  assert.equal(closestCatalogName('gateway-strip', index.modules), 'gateway_stripe')
  assert.equal(closestCatalogName('@open-mercato/gateway-stripee', index.modules), '@open-mercato/gateway-stripe')
  assert.equal(closestCatalogName('nonexistent-x', index.modules), null)
  assert.equal(closestCatalogName('  ', index.modules), null)
})

const SHIPMENT_WARNING =
  'Adds the backend route /backend/webhooks, which a new app on 0.8, 0.9 and next already has from the webhooks module (@open-mercato/webhooks). The generate step refuses two modules with one backend route.'
const SHIPMENT = 'yarn mercato module add @freighttech/shipment-tracking@0.7.2 --allow-third-party'

test('parsePickerIndex reads conflictsWith and warning, and entries without them', () => {
  const shipment = index.modules.find((entry) => entry.id === 'shipment_tracking')!
  assert.deepEqual(shipment.conflictsWith, ['webhooks'])
  assert.equal(shipment.warning, SHIPMENT_WARNING)
  const ksef = index.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.deepEqual(ksef.conflictsWith, [])
  assert.equal(ksef.warning, null)
})

/** The fixture with the webhooks module a new classic app registers on `inPresets`, as the catalog lists it. */
function fixtureWithWebhooks(inPresets: string[]): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  body.modules.push({
    id: 'webhooks',
    from: '@open-mercato/webhooks',
    title: 'Webhooks',
    description: 'Outbound and inbound webhooks.',
    requires: [],
    source: 'official',
    locator: 'npm:@open-mercato/webhooks',
    license: { spdx: 'MIT', kind: 'osi' },
    tier: 'verified',
    verifiedOn: [],
    install: 'yarn mercato module add @open-mercato/webhooks@0.9.0',
    installByLine: {},
    inPresets,
  })
  return body
}

test('collisionWarning applies to a classic app, and to another preset only when it has a conflicting module', () => {
  const shipment = index.modules.find((entry) => entry.id === 'shipment_tracking')!
  assert.equal(collisionWarning(shipment, null, '0.8', index.modules), SHIPMENT_WARNING)
  assert.equal(collisionWarning(shipment, ['auth', 'webhooks'], '0.8', index.modules), SHIPMENT_WARNING)
  assert.equal(collisionWarning(shipment, ['auth'], '0.8', index.modules), null)
  assert.equal(collisionWarning({ ...shipment, conflictsWith: [] }, ['auth'], '0.8', index.modules), SHIPMENT_WARNING)
  const ksef = index.modules.find((entry) => entry.id === 'integration_ksef_direct')!
  assert.equal(collisionWarning(ksef, null, '0.9', index.modules), null)
})

test('collisionWarning for a classic app keeps the lines whose app registers the conflicting module', () => {
  const shipment = index.modules.find((entry) => entry.id === 'shipment_tracking')!
  const onAllLines = (parsePickerIndex(fixtureWithWebhooks(['0.8', '0.9', 'next'])) as PickerIndex).modules
  assert.equal(collisionWarning(shipment, null, '0.8', onAllLines), SHIPMENT_WARNING)
  const onlyOnNine = (parsePickerIndex(fixtureWithWebhooks(['0.9'])) as PickerIndex).modules
  assert.equal(collisionWarning(shipment, null, '0.8', onlyOnNine), null)
  assert.equal(collisionWarning(shipment, null, '0.9', onlyOnNine), SHIPMENT_WARNING)
})

test('runCatalogStep plans a module with a route collision and shows the catalog warning', async () => {
  const { options, logs, warnings } = stepOptions({ version: '0.8.2', requested: ['shipment_tracking'], presetModuleIds: null })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [SHIPMENT])
  assert.deepEqual(result.commandWarnings, { [SHIPMENT]: SHIPMENT_WARNING })
  const planned = logs.indexOf('  shipment_tracking from @freighttech/shipment-tracking (third-party · MIT · listed, installs on 0.8)')
  assert.ok(planned >= 0)
  assert.deepEqual(warnings, [`    Warning: ${SHIPMENT_WARNING}`])

  const withoutWebhooks = stepOptions({
    version: '0.8.2',
    requested: ['shipment_tracking'],
    presetModuleIds: ['auth'],
    presetModules: [{ id: 'auth', from: '@open-mercato/core' }],
  })
  assert.deepEqual(await runCatalogStep(withoutWebhooks.options), {
    commands: [SHIPMENT],
    selectionFile: join(withoutWebhooks.options.targetDir, CATALOG_SELECTION_FILE),
    commandWarnings: {},
  })
  assert.deepEqual(withoutWebhooks.warnings, [])

  const notOnLine = stepOptions({
    version: '0.8.2',
    requested: ['shipment_tracking'],
    presetModuleIds: null,
    fetchImpl: fakeFetch(['ok'], () => fixtureWithWebhooks(['0.9'])).fetchImpl,
  })
  assert.deepEqual((await runCatalogStep(notOnLine.options)).commandWarnings, {})
  assert.deepEqual(notOnLine.warnings, [])
})

test('runCatalogStep shows the catalog warning under the module in the picker', async () => {
  const { options, logs, warnings } = stepOptions({ version: '0.8.2', picker: true, presetModuleIds: null, ask: async () => '1' })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [SHIPMENT])
  assert.ok(logs.includes('   1. shipment_tracking  Shipment Tracking  (third-party · MIT · listed, installs on 0.8)'))
  assert.equal(warnings[0], `      Warning: ${SHIPMENT_WARNING}`)
})

test('parsePickerIndex strips control characters from catalog text before it reaches the terminal', () => {
  const body = fixture() as { lines: string[]; modules: Record<string, unknown>[] }
  const shipment = body.modules.find((entry) => entry.id === 'shipment_tracking') as Record<string, unknown>
  shipment.title = 'Shipment\u001b[2K Tracking'
  shipment.warning = 'Adds a route.\u009b31m'
  shipment.installByLine = { '0.8': `${SHIPMENT}\u0007` }
  const parsed = (parsePickerIndex(body) as PickerIndex).modules.find((entry) => entry.id === 'shipment_tracking')!
  assert.equal(parsed.title, 'Shipment [2K Tracking')
  assert.equal(parsed.warning, 'Adds a route. 31m')
  assert.deepEqual(parsed.installByLine, { '0.8': `${SHIPMENT} ` })

  const keyed = fixture() as { modules: Record<string, unknown>[] }
  const entry = keyed.modules.find((item) => item.id === 'shipment_tracking') as Record<string, unknown>
  entry.installByLine = { '0.8\u0007': SHIPMENT }
  const parsedKeys = (parsePickerIndex(keyed) as PickerIndex).modules.find((item) => item.id === 'shipment_tracking')!
  assert.deepEqual(parsedKeys.installByLine, { '0.8 ': SHIPMENT })
})

const SHOPIFY = 'yarn mercato module add @northbound-run/sync-shopify@0.5.0 --allow-third-party'
const CLOUDFLARE = 'yarn mercato module add @open-mercato/search-cloudflare@0.9.0'
const RESEND = 'yarn mercato module add @open-mercato/channel-resend@0.9.0'
const STRIPE = 'yarn mercato module add @open-mercato/gateway-stripe@0.9.0'

/**
 * The fixture with catalog rows whose `requires` name a core module (sync_shopify needs data_sync, which a durable
 * package replaces) or a package by npm name (search_cloudflare, channel_resend), as picker.json publishes them, and
 * with gateway_stripe verified on every line, where a new classic app already ships it.
 */
function fixtureWithRequirements(syncRequires: string[] = ['integrations', 'data_sync']): Record<string, unknown> {
  const body = fixture() as { modules: Record<string, unknown>[] }
  const license = { spdx: 'MIT', kind: 'osi' }
  body.modules.push(
    {
      id: 'sync_shopify',
      from: '@northbound-run/sync-shopify',
      title: 'Shopify Sync',
      description: 'Imports Shopify products and orders through data sync.',
      requires: syncRequires,
      source: 'third-party',
      locator: 'npm:@northbound-run/sync-shopify',
      license,
      tier: 'listed',
      verifiedOn: ['0.9', 'next'],
      install: SHOPIFY,
      installByLine: { '0.9': SHOPIFY, next: SHOPIFY },
    },
    {
      id: 'search_cloudflare',
      from: '@open-mercato/search-cloudflare',
      title: 'Cloudflare Search',
      description: 'Vector search on Cloudflare.',
      requires: ['search', '@open-mercato/search'],
      source: 'official',
      locator: 'npm:@open-mercato/search-cloudflare',
      license,
      tier: 'verified',
      verifiedOn: ['0.9'],
      install: CLOUDFLARE,
      installByLine: { '0.9': CLOUDFLARE },
    },
    {
      id: 'channel_resend',
      from: '@open-mercato/channel-resend',
      title: 'Resend Channel',
      description: 'Sends email through Resend.',
      requires: ['communication_channels', '@open-mercato/ai-assistant'],
      source: 'official',
      locator: 'npm:@open-mercato/channel-resend',
      license,
      tier: 'verified',
      verifiedOn: ['0.9'],
      install: RESEND,
      installByLine: {},
      inPresets: ['0.8', '0.9', 'next'],
    },
  )
  const stripe = body.modules.find((entry) => entry.id === 'gateway_stripe') as Record<string, unknown>
  stripe.verifiedOn = ['0.8', '0.9', 'next']
  return body
}

const presetOptions = (presetId: string) => {
  const preset = resolvePreset(presetId)
  return { presetModuleIds: preset.modules.map((entry) => entry.id), presetModules: preset.modules }
}

const withRequirements = (overrides: Partial<CatalogStepOptions> = {}, body = () => fixtureWithRequirements()) =>
  stepOptions({ fetchImpl: fakeFetch(['ok'], body).fetchImpl, ...overrides })

test('runCatalogStep keeps a core requirement on core instead of planning the package that replaces it', async () => {
  const { options, warnings } = withRequirements({ requested: ['sync_shopify'], presetModuleIds: null })
  const result = await runCatalogStep(options)
  assert.deepEqual(result.commands, [SHOPIFY])
  const saved = JSON.parse(readFileSync(result.selectionFile ?? '', 'utf8'))
  assert.deepEqual(saved.modules.map((entry: { from: string }) => entry.from), ['@northbound-run/sync-shopify'])
  assert.ok(!result.commands.some((command) => command.includes('@fullstackhouse')))
  assert.deepEqual(warnings, [])
})

test('runCatalogStep plans the package that replaces a core requirement when the user asks for it', async () => {
  const { options, logs } = withRequirements({
    requested: ['sync_shopify', '@fullstackhouse/open-mercato-data-sync-durable'],
    presetModuleIds: null,
  })
  assert.deepEqual((await runCatalogStep(options)).commands, [WORK_A, DURABLE_SYNC, SHOPIFY])
  assert.ok(logs.some((line) => line.startsWith('  data_sync from @fullstackhouse/open-mercato-data-sync-durable')))
})

test('runCatalogStep warns that a preset lacks a core requirement and plans no package for it', async () => {
  const { options, warnings } = withRequirements({ requested: ['sync_shopify'], ...presetOptions('crm') })
  assert.deepEqual((await runCatalogStep(options)).commands, [SHOPIFY])
  assert.deepEqual(warnings, [
    'sync_shopify requires data_sync, which the preset does not enable: yarn mercato module enable @open-mercato/core --module data_sync',
  ])
})

test('resolveCatalogSelection reads a core requirement written as core:<id> too', () => {
  const parsed = parsePickerIndex(fixtureWithRequirements(['integrations', 'core:data_sync'])) as PickerIndex
  const selectable = selectableModules(parsed, '0.9')
  const coreModuleIds = parsed.modules.filter((entry) => entry.source === 'core').map((entry) => entry.id)
  const classic = resolveCatalogSelection(['sync_shopify'], selectable, null, [], { coreModuleIds })
  assert.deepEqual(installCommands(classic), [SHOPIFY])
  const crm = resolveCatalogSelection(['sync_shopify'], selectable, ['auth', 'integrations'], [], { coreModuleIds })
  assert.deepEqual(crm.unmetRequires, [{ id: 'sync_shopify', requires: 'data_sync' }])
  assert.deepEqual(installCommands(crm), [SHOPIFY])
})

test('runCatalogStep tells a preset other than classic why an older line or next has no command', async () => {
  for (const version of ['0.8.2', '0.10.1-develop.7583.1.0c886d0a14']) {
    const line = version === '0.8.2' ? '0.8' : 'next'
    const requested = withRequirements({ version, requested: ['gateway_stripe'], ...presetOptions('crm') })
    assert.deepEqual(await runCatalogStep(requested.options), { commands: [], selectionFile: null, commandWarnings: {} })
    assert.deepEqual(requested.warnings, [
      `gateway_stripe is verified on ${line}, where a new classic app already ships it, and the module catalog has no install command for other presets on ${line}. Add it later from https://modules.openmercato.com.`,
    ])
    assert.ok(!requested.warnings.some((warning) => warning.includes(' yet')))

    const picker = withRequirements({ version, picker: true, ask: async () => '', ...presetOptions('empty') })
    await runCatalogStep(picker.options)
    assert.ok(
      picker.warnings.includes(
        `Left out of the list: gateway_stripe. A new classic app on ${line} already ships them, and the module catalog has no install command for other presets on ${line}.`,
      ),
    )
  }
  const latest = withRequirements({ requested: ['gateway_stripe'], ...presetOptions('crm') })
  assert.deepEqual((await runCatalogStep(latest.options)).commands, [STRIPE])
})

test('runCatalogStep checks a requirement named by npm name against the packages the preset registers', async () => {
  for (const presetId of ['crm', 'empty']) {
    const search = withRequirements({ requested: ['search_cloudflare'], ...presetOptions(presetId) })
    assert.deepEqual((await runCatalogStep(search.options)).commands, [CLOUDFLARE])
    assert.deepEqual(search.warnings, [])
  }
  const parsed = parsePickerIndex(fixtureWithRequirements()) as PickerIndex
  const crm = presetOptions('crm')
  assert.deepEqual(
    resolveCatalogSelection(['search_cloudflare'], selectableModules(parsed, '0.9'), crm.presetModuleIds, [], crm).unmetRequires,
    [],
  )

  const resendInCrm = withRequirements({ requested: ['channel_resend'], ...presetOptions('crm') })
  assert.deepEqual((await runCatalogStep(resendInCrm.options)).commands, [RESEND])
  assert.deepEqual(resendInCrm.warnings, [])

  const resendInEmpty = withRequirements({ requested: ['channel_resend'], ...presetOptions('empty') })
  assert.deepEqual((await runCatalogStep(resendInEmpty.options)).commands, [RESEND])
  assert.ok(
    resendInEmpty.warnings.includes(
      'channel_resend requires @open-mercato/ai-assistant, which the preset does not enable: install @open-mercato/ai-assistant first',
    ),
  )
})

test('runCatalogStep answers a core module ID with core, not with the package that replaces it', async () => {
  const classic = withRequirements({ requested: ['data_sync'], presetModuleIds: null })
  assert.deepEqual(await runCatalogStep(classic.options), { commands: [], selectionFile: null, commandWarnings: {} })
  assert.ok(classic.logs.includes('data_sync is built into Open Mercato core and the preset already enables it.'))
  assert.deepEqual(classic.warnings, [])

  const crm = withRequirements({ requested: ['data_sync'], ...presetOptions('crm') })
  assert.deepEqual((await runCatalogStep(crm.options)).commands, [])
  assert.deepEqual(crm.warnings, [
    'data_sync is built into Open Mercato core, not a package: yarn mercato module enable @open-mercato/core --module data_sync',
  ])

  const byName = withRequirements({ requested: ['@fullstackhouse/open-mercato-data-sync-durable'], presetModuleIds: null })
  assert.deepEqual((await runCatalogStep(byName.options)).commands, [WORK_A, DURABLE_SYNC])
})

for (const command of [
  'yarn mercato module add @open-mercato/gateway-stripe@0.9.0',
  'yarn mercato module enable @open-mercato/core --module sales',
]) {
  test(`installCommandFor accepts ${command}`, () => {
    const entry = index.modules[0]!
    assert.equal(installCommandFor({ ...entry, install: command, installByLine: null }, '0.9', index.lines), command)
    assert.equal(installCommandFor({ ...entry, installByLine: { '0.8': command } }, '0.8', index.lines), command)
  })
}

for (const command of [
  'curl https://example.com/install',
  'yarn mercato module remove example',
  'yarn mercato module add ',
  ...['; echo injected', '& echo injected', '| cat', '`id`', '$(id)', '> output', '< input', '$HOME', '\\; echo injected', '\necho injected']
    .map((suffix) => `yarn mercato module add example ${suffix}`),
]) {
  test(`installCommandFor rejects ${JSON.stringify(command)} without a latest-line fallback`, () => {
    const entry = index.modules[0]!
    assert.equal(installCommandFor({ ...entry, install: command, installByLine: null }, '0.9', index.lines), null)
    assert.equal(installCommandFor({ ...entry, installByLine: { '0.9': command } }, '0.9', index.lines), null)
  })
}

test('unsafe catalog commands are omitted from the picker and reported as missing for --modules', async () => {
  for (const field of ['install', 'installByLine']) {
    const body = fixture() as { modules: Record<string, unknown>[] }
    const entry = body.modules.find((candidate) => candidate.id === 'integration_ksef_direct')!
    const unsafe = 'yarn mercato module add example; echo injected'
    if (field === 'install') {
      entry.install = unsafe
      delete entry.installByLine
    } else {
      entry.installByLine = { '0.9': unsafe }
    }
    const parsed = parsePickerIndex(body)!
    assert.ok(!selectableModules(parsed, '0.9').some((candidate) => candidate.id === entry.id))
    assert.ok(modulesWithoutLineInstall(parsed, '0.9').some((candidate) => candidate.id === entry.id))
    const requested = stepOptions({ requested: ['integration_ksef_direct'], fetchImpl: fakeFetch(['ok'], () => body).fetchImpl })
    const result = await runCatalogStep(requested.options)
    assert.deepEqual(result.commands, [])
    assert.equal(result.selectionFile, null)
    assert.ok(requested.warnings.some((warning) => warning.includes('gives no install command for 0.9')))
  }
})
