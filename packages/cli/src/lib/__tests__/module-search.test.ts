import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseModuleInfoArgs, parseModuleSearchArgs } from '../module-search-args'
import {
  createCatalogSearcher,
  resolveLine,
  searchModules,
  type BuiltInIndex,
  type BuiltInModule,
  type CatalogEntry,
  type CatalogIndex,
  type SearchModulesInput,
  type SearchModulesOutput,
} from '../module-search-index'
import {
  buildInfoView,
  buildSearchView,
  DEFAULT_MODULES_INDEX_URL,
  defaultBuiltInUrl,
  loadIndex,
  MODULE_INDEX_CACHE_FILE,
  MODULE_INDEX_MAX_BYTES,
  MODULE_INDEX_UNAVAILABLE_EXIT_CODE,
  MODULE_INDEX_UNAVAILABLE_MESSAGE,
  BUILT_IN_UNAVAILABLE_MESSAGE,
  parseBuiltInIndex,
  parseCatalogIndex,
  renderInfoHuman,
  runModuleInfo,
  withFollowUpSteps,
  runModuleSearch,
  type FetchLike,
  type FetchResponseLike,
  type ModuleSearchDeps,
} from '../module-search'
import { readEnabledModules } from '../modules-config'

const FIXTURES = path.join(__dirname, '..', '__fixtures__', 'module-search')
const readFixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8'))

const index = parseCatalogIndex(readFixture('modules-index.json')) as CatalogIndex
const builtIn = parseBuiltInIndex(readFixture('built-in.json')) as BuiltInIndex

type ParityInfo =
  | { ref: string; ok: true; locator: string | null; candidates: string[]; warnings: string[]; card: string | null }
  | { ref: string; ok: false; error: string; candidates: string[] }

type ParityCases = {
  search: { input: SearchModulesInput; output: SearchModulesOutput }[]
  info: ParityInfo[]
}

type ParityPatch = {
  dataAsOf?: Partial<NonNullable<CatalogIndex['dataAsOf']>>
  addEntries?: CatalogEntry[]
  entries?: Record<string, { compat?: Partial<CatalogEntry['compat']> }>
  builtIn?: Record<string, Partial<BuiltInModule>>
}

const parity = readFixture('catalog-parity.json') as ParityCases & {
  now: string
  variants: (ParityCases & { name: string; patch: ParityPatch })[]
}

// The same merge the golden generator applies before it runs the catalog (see the fixture README).
function patchedFixture(patch: ParityPatch): { index: CatalogIndex; builtIn: BuiltInIndex } {
  const patchedIndex = structuredClone(index)
  const patchedBuiltIn = structuredClone(builtIn)
  if (patch.dataAsOf) patchedIndex.dataAsOf = { ...patchedIndex.dataAsOf, ...patch.dataAsOf }
  for (const entry of patchedIndex.entries) {
    const compat = patch.entries?.[entry.locator]?.compat
    if (compat) entry.compat = { ...entry.compat, ...compat }
  }
  if (patch.addEntries) patchedIndex.entries.push(...structuredClone(patch.addEntries))
  patchedBuiltIn.modules = patchedBuiltIn.modules.map((coreModule) => ({ ...coreModule, ...(patch.builtIn?.[coreModule.id] ?? {}) }))
  return { index: patchedIndex, builtIn: patchedBuiltIn }
}

const parityRuns = [
  { name: 'fixture', cases: parity as ParityCases, data: { index, builtIn } },
  ...parity.variants.map((variant) => ({ name: variant.name, cases: variant as ParityCases, data: patchedFixture(variant.patch) })),
]

const BUILT_IN_CARD_KEYS = ['category', 'description', 'enabled', 'id', 'install', 'matchedOn', 'page', 'presetNote', 'title']
const MODULE_CARD_KEYS = [
  'agentPolicy',
  'card',
  'category',
  'install',
  'installableFrom',
  'kind',
  'license',
  'line',
  'locator',
  'matchedOn',
  'omQuality',
  'path',
  'status',
  'summary',
  'tier',
  'title',
  'type',
  'verifiedOn',
  'whenToUse',
]

const GOLDEN_IN_FIXTURE: [string, string[], string[]][] = [
  ['exchange rates', [], ['currencies']],
  ['ksef', ['@fastwhitecat/integration-ksef-direct'], []],
  ['e-invoicing poland', ['@fastwhitecat/integration-ksef-direct'], []],
  ['stripe', ['@open-mercato/gateway-stripe'], []],
  ['card payments', ['@open-mercato/gateway-stripe'], []],
  ['tpay', ['@open-mercato/gateway-tpay'], []],
  ['durable jobs', ['@fullstackhouse/open-mercato-durable-work'], []],
  ['data_sync', ['@fullstackhouse/open-mercato-data-sync-durable'], ['data_sync']],
  ['warehouse', [], ['wms']],
]

function jsonResponse(status: number, body: unknown, etag: string | null = null): FetchResponseLike {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null) },
    body: status === 304 ? null : new Response(JSON.stringify(body)).body,
    json: async () => body,
  }
}

type FetchCall = { url: string; headers: Record<string, string> }

function fixtureFetch(
  options: { fail?: boolean; failFirst?: number; notModified?: boolean; noBuiltIn?: boolean; patch?: ParityPatch } = {},
) {
  const data = options.patch ? patchedFixture(options.patch) : null
  const calls: FetchCall[] = []
  let failuresLeft = options.failFirst ?? 0
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers ?? {} })
    if (options.fail) throw new Error('getaddrinfo ENOTFOUND modules.openmercato.com')
    if (failuresLeft > 0) {
      failuresLeft -= 1
      throw new Error('socket hang up')
    }
    if (options.notModified && init?.headers?.['if-none-match']) return jsonResponse(304, null)
    if (url.endsWith('/modules.json')) return jsonResponse(200, data?.index ?? readFixture('modules-index.json'), '"idx-1"')
    if (url.endsWith('/built-in.json') && !options.noBuiltIn) {
      return jsonResponse(200, data?.builtIn ?? readFixture('built-in.json'), '"bi-1"')
    }
    return jsonResponse(404, null)
  }
  return { fetchImpl, calls }
}

function tempApp(options: { coreVersion?: string; coreRange?: string; modulesTs?: string } = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'om-module-search-'))
  const dependencies: Record<string, string> = {}
  if (options.coreRange) dependencies['@open-mercato/core'] = options.coreRange
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'app', dependencies }))
  if (options.coreVersion) {
    const coreDir = path.join(root, 'node_modules', '@open-mercato', 'core')
    fs.mkdirSync(coreDir, { recursive: true })
    fs.writeFileSync(path.join(coreDir, 'package.json'), JSON.stringify({ name: '@open-mercato/core', version: options.coreVersion }))
  }
  if (options.modulesTs) {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'modules.ts'), options.modulesTs)
  }
  return root
}

function capture() {
  const stdout: string[] = []
  const stderr: string[] = []
  return { stdout, stderr, out: (line: string) => stdout.push(line), err: (line: string) => stderr.push(line) }
}

const NOW = Date.parse(parity.now)

function deps(appRoot: string, fetchImpl: FetchLike, io: ReturnType<typeof capture>, now = NOW): ModuleSearchDeps {
  return { appRoot, env: {}, fetchImpl, now: () => now, stdout: io.out, stderr: io.err, readEnabledModules }
}

describe('module search fixture', () => {
  it('parses the published modules.json and built-in.json of the catalog', () => {
    expect(index).not.toBeNull()
    expect(builtIn).not.toBeNull()
    expect(index.site).toBe('https://modules.openmercato.com')
    expect(index.entries).toHaveLength(8)
    expect(builtIn.modules.map((module) => module.id)).toEqual(['currencies', 'data_sync', 'wms'])
  })

  it('rejects data that is not a modules-1 index', () => {
    expect(parseCatalogIndex({ schemaVersion: 2, entries: [] })).toBeNull()
    expect(parseCatalogIndex({ ...index, entries: [{ locator: 'npm:x' }] })).toBeNull()
    expect(parseBuiltInIndex({ schemaVersion: 1, coreVersion: '0.9.0', modules: [{ id: 'x' }] })).toBeNull()
  })

  it('ignores a line source or a receipt source this CLI does not know yet', () => {
    const parsed = parseCatalogIndex({
      ...index,
      lines: [...index.lines, { key: '0.7', version: '0.7.4', source: 'lts' }],
      dataAsOf: { source: 'nightly' },
    }) as CatalogIndex
    expect(parsed.lines.map((line) => line.key)).toEqual(index.lines.map((line) => line.key))
    expect(searchModules(createCatalogSearcher(parsed, builtIn), { query: 'ksef' }).receiptSource).toBeNull()
  })

  it('rejects an index whose nested fields search or module info would trip over', () => {
    const ksef = index.entries.find((entry) => entry.locator === 'npm:@fastwhitecat/integration-ksef-direct') as CatalogEntry
    const anatomy = ksef.anatomy as NonNullable<CatalogEntry['anatomy']>
    const broken: Record<string, unknown>[] = [
      { providers: [null] },
      { providers: [{ name: 'ksef' }] },
      { agentPolicy: { '0.9': { decision: 'allow', reasons: null } } },
      { version: { ...ksef.version, recommended: { '0.9': 7 } } },
      { compat: { ...ksef.compat, lines: { '0.9': null } } },
      { anatomy: { ...anatomy, lists: { ...anatomy.lists, credentials: [null] } } },
      { anatomy: { ...anatomy, lists: { ...anatomy.lists, hosts: 'api.ksef.mf.gov.pl' } } },
      { signals: { supplyChain: { status: 'warn', reasons: null } } },
      { license: { spdx: 1, kind: 'osi' } },
    ]
    for (const change of broken) {
      const entries = index.entries.map((entry) => (entry === ksef ? { ...entry, ...change } : entry))
      expect(parseCatalogIndex({ ...index, entries })).toBeNull()
    }
    const core = builtIn.modules[0] as BuiltInModule
    expect(parseBuiltInIndex({ ...builtIn, modules: [{ ...core, anatomy: { lists: { tables: [1] } } }] })).toBeNull()
  })
})

describe.each(parityRuns)('parity with the catalog search_modules tool (tools@1), $name', ({ cases, data }) => {
  const searcher = createCatalogSearcher(data.index, data.builtIn)

  it.each(cases.search.map((item) => [JSON.stringify(item.input), item] as const))('%s', (_label, item) => {
    expect(searchModules(searcher, item.input)).toEqual(item.output)
  })
})

describe('golden queries of the catalog spec', () => {
  const searcher = createCatalogSearcher(index, builtIn)

  it.each(GOLDEN_IN_FIXTURE)('golden query "%s" keeps its expected result in the top 3', (query, modules, builtIns) => {
    const result = searchModules(searcher, { query })
    const top = result.results.slice(0, 3).map((card) => card.locator.replace(/^npm:/, ''))
    const topBuiltIn = result.builtIn.slice(0, 3).map((card) => card.id)
    for (const name of modules) expect(top).toContain(name)
    for (const id of builtIns) expect(topBuiltIn).toContain(id)
  })
})

describe.each(parityRuns)('parity with the catalog get_module tool (tools@1), $name', ({ cases, data }) => {
  const searcher = createCatalogSearcher(data.index, data.builtIn)
  const today = parity.now.slice(0, 10)

  it.each(cases.info.map((item) => [item.ref, item] as const))('%s', (ref, expected) => {
    const view = buildInfoView(searcher, ref, { omVersion: null, enabledModules: null }, today)
    if (!expected.ok) {
      expect(view.found).toBe(false)
      expect(view.json).toEqual({ schemaVersion: 1, error: expected.error, candidates: expected.candidates })
      return
    }
    expect(view.found).toBe(true)
    if ('error' in view.json) throw new Error('expected an entry')
    expect(view.json.entry?.locator ?? null).toBe(expected.locator)
    expect(view.json.candidates).toEqual(expected.candidates)
    expect(view.json.warnings).toEqual(expected.warnings)
    expect(view.json.card).toBe(expected.card)
  })
})

describe('resolveLine', () => {
  it('maps exact, major.minor, ranges and develop builds to catalog lines', () => {
    expect(resolveLine('0.9.0', index.lines).line).toBe('0.9')
    expect(resolveLine('^0.8.0', index.lines).line).toBe('0.8')
    expect(resolveLine('0.9', index.lines).line).toBe('0.9')
    expect(resolveLine('0.10.1-develop.7590.1.abc', index.lines).line).toBe('next')
    expect(resolveLine('0.7.4', index.lines)).toEqual({ line: null, version: null, note: 'Line 0.7 is not tested by the catalog.' })
    expect(resolveLine(null, index.lines).line).toBe('0.9')
  })
})

describe('module search catalog version forms', () => {
  it.each([
    '0.10.1-develop.1+build', '0.9.0+build', '0.9.0-rc.01', '0.10.1-develop.01',
    '00.9.0', '0.09.0', '0.9.00', '0.9.0-rc..1', '0.9.0-rc.', '0.9-rc.1',
  ])('rejects non-catalog version %s', (version) => {
    expect(resolveLine(version, index.lines)).toEqual({ line: null, version: null, note: 'Unknown Open Mercato version.' })
  })

  it.each(['0.9.0-rc.0', '0.9.0-rc.1a', '~0.9.2', 'v0.9.0'])('keeps valid version %s', (version) => {
    expect(resolveLine(version, index.lines).line).toBe('0.9')
  })
})

describe('module search visibility regressions', () => {
  function entry(locator: string, title: string, verified: boolean, kind: CatalogEntry['kind'] = 'module'): CatalogEntry {
    const base = structuredClone(index.entries[0])
    return {
      ...base, locator, title, kind, npm: locator, summary: '', whenToUse: '', tags: [], providers: [],
      moduleIds: [], renamedFrom: [], anatomy: null, _meta: {}, listed: true,
      version: { ...base.version, recommended: verified ? { '0.9': '0.9.0' } : {} },
      compat: { ...base.compat, lines: {}, verifiedOn: verified ? ['0.9'] : [] },
    }
  }

  it.each([0, 1])('fills verified partial matches despite three hidden AND hits (%s visible AND)', (visibleAnd) => {
    const entries = [
      ...[1, 2, 3].map((number) => entry(`hidden-${number}`, 'quantum zebra', false)),
      entry('partial', 'quantum', true),
      ...(visibleAnd ? [entry('exact', 'quantum zebra', true)] : []),
    ]
    const searcher = createCatalogSearcher({ ...index, entries }, null)
    const view = buildSearchView(searcher, { query: 'quantum zebra' }, { omVersion: '0.9.0', enabledModules: null })
    expect(view.json.results.map((card) => card.locator)).toContain('partial')
    expect(view.json.results.every((card) => !card.locator.startsWith('hidden-'))).toBe(true)
    expect(view.json.hidden).toBe(3)
    expect(view.json.total).toBe(3 + visibleAnd)
    const all = buildSearchView(searcher, { query: 'quantum zebra', allLines: true }, { omVersion: '0.9.0', enabledModules: null })
    expect(all.json.results.map((card) => card.locator)).toContain('hidden-1')
    expect(all.json.hidden).toBe(0)
  })

  it('retries a typo when only unverified modules match the original spelling', () => {
    const searcher = createCatalogSearcher({ ...index, entries: [
      entry('hidden', 'stirpe', false), entry('visible', 'stripe', true),
    ] }, null)
    const view = buildSearchView(searcher, { query: 'stirpe' }, { omVersion: '0.9.0', enabledModules: null })
    expect(view.json.results.map((card) => card.locator)).toEqual(['visible'])
    expect(view.json.didYouMean).toBe('stripe')
    expect(view.json.hidden).toBe(1)
  })

  it('retains unverified providers, libraries and tools while filtering modules before ranking', () => {
    const entries = (['provider', 'library', 'tool', 'module'] as const).map((kind) => entry(kind, 'quantum', false, kind))
    const view = buildSearchView(createCatalogSearcher({ ...index, entries }, null), { query: 'quantum' }, { omVersion: '0.9.0', enabledModules: null })
    expect(view.json.results.map((card) => card.kind).sort()).toEqual(['library', 'provider', 'tool'])
    expect(view.json.hidden).toBe(1)
  })
})

describe('yarn mercato module search', () => {
  it('prints the tools@1 contract for "ksef" --json', async () => {
    const io = capture()
    const { fetchImpl } = fixtureFetch()
    const code = await runModuleSearch(['ksef', '--json'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io))
    expect(code).toBe(0)
    const json = JSON.parse(io.stdout.join('\n'))
    expect(Object.keys(json).sort()).toEqual(
      [
        'builtIn',
        'dataVersion',
        'generatedAt',
        'hidden',
        'line',
        'omVersion',
        'query',
        'receiptSource',
        'results',
        'schemaVersion',
        'total',
      ],
    )
    expect(json).toMatchObject({ schemaVersion: 1, query: 'ksef', line: '0.9', omVersion: '0.9.0', hidden: 0 })
    expect(json.dataVersion).toBe(index.dataVersion)
    expect(json.results[0].locator).toBe('npm:@fastwhitecat/integration-ksef-direct')
    expect(Object.keys(json.results[0]).sort()).toEqual(MODULE_CARD_KEYS)
    expect(json.results[0].install).toBe('yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party')
    expect(json.results[0].card).toBe('https://modules.openmercato.com/m/@fastwhitecat/integration-ksef-direct')
  })

  it('shows built-in modules first with the enable command, or "Already enabled." when src/modules.ts has them', async () => {
    const first = capture()
    const { fetchImpl } = fixtureFetch()
    await runModuleSearch(['exchange', 'rates'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, first))
    expect(first.stdout[0]).toBe('Already in Open Mercato core:')
    expect(first.stdout[1]).toContain('yarn mercato module enable @open-mercato/core --module currencies')

    const second = capture()
    const app = tempApp({
      coreVersion: '0.9.0',
      modulesTs: "export const enabledModules = [\n  { id: 'auth', from: '@open-mercato/core' },\n  { id: 'currencies' },\n]\n",
    })
    await runModuleSearch(['exchange rates', '--json'], deps(app, fetchImpl, second))
    expect(JSON.parse(second.stdout.join('\n')).builtIn[0]).toMatchObject({ id: 'currencies', enabled: true })
    const third = capture()
    await runModuleSearch(['exchange rates'], deps(app, fetchImpl, third))
    expect(third.stdout[1]).toContain('Already enabled.')
    expect(Object.keys(JSON.parse(second.stdout.join('\n')).builtIn[0]).sort()).toEqual(BUILT_IN_CARD_KEYS)
  })

  it('hides modules not verified on the app line unless --all-lines is passed', async () => {
    const { fetchImpl } = fixtureFetch()
    const app = tempApp({ coreVersion: '0.9.0' })
    const human = capture()
    await runModuleSearch(['gateway'], deps(app, fetchImpl, human))
    const text = human.stdout.join('\n')
    expect(text).toContain('@open-mercato/gateway-stripe 0.9.0   VERIFIED · 0.9   official · MIT')
    expect(text).not.toContain('@open-mercato/gateway-tpay')
    expect(text).toContain('1 more module is listed but not verified on 0.9. Use --all-lines.')

    const all = capture()
    await runModuleSearch(['gateway', '--all-lines', '--json'], deps(app, fetchImpl, all))
    const json = JSON.parse(all.stdout.join('\n'))
    expect(json.hidden).toBe(0)
    expect(json.results.map((card: { locator: string }) => card.locator)).toEqual([
      'npm:@open-mercato/gateway-stripe',
      'npm:@open-mercato/gateway-tpay',
    ])
  })

  it('says that nothing verified on the app line matched when every match is hidden', async () => {
    const io = capture()
    await runModuleSearch(['ksef'], deps(tempApp({ coreVersion: '0.8.0' }), fixtureFetch().fetchImpl, io))
    expect(io.stdout).toEqual([
      'No modules verified on 0.8 matched "ksef".',
      '1 more module is listed but not verified on 0.8. Use --all-lines.',
      'Browse the catalog: https://modules.openmercato.com',
    ])
  })

  it('prints installable from only while the date is still ahead', async () => {
    const app = tempApp({ coreVersion: '0.8.0' })
    const past = capture()
    await runModuleSearch(['ksef', '--all-lines'], deps(app, fixtureFetch().fetchImpl, past))
    expect(past.stdout.join('\n')).toContain('@fastwhitecat/integration-ksef-direct 0.1.8')
    expect(past.stdout.join('\n')).not.toContain('installable from')

    const ahead = capture()
    await runModuleSearch(['ksef', '--all-lines'], deps(tempApp({ coreVersion: '0.8.0' }), fixtureFetch().fetchImpl, ahead, Date.parse('2026-10-15T12:00:00Z')))
    expect(ahead.stdout).toContain('  installable from: 2026-10-20')
  })

  it('uses the line of the installed @open-mercato/core, then the package.json range', async () => {
    const { fetchImpl } = fixtureFetch()
    const installed = capture()
    await runModuleSearch(['ksef', '--json', '--all-lines'], deps(tempApp({ coreVersion: '0.8.0' }), fetchImpl, installed))
    expect(JSON.parse(installed.stdout.join('\n'))).toMatchObject({ line: '0.8', omVersion: '0.8.0' })
    const ranged = capture()
    await runModuleSearch(['ksef', '--json'], deps(tempApp({ coreRange: '^0.9.0' }), fetchImpl, ranged))
    expect(JSON.parse(ranged.stdout.join('\n'))).toMatchObject({ line: '0.9', omVersion: '0.9.0' })
  })

  it('shows every line with a note when the app runs a version the catalog does not test', async () => {
    const { fetchImpl } = fixtureFetch()
    const io = capture()
    await runModuleSearch(['gateway'], deps(tempApp({ coreVersion: '0.7.2' }), fetchImpl, io))
    expect(io.stdout[0]).toContain('Open Mercato 0.7.2 is not a line the catalog tests')
    expect(io.stdout.join('\n')).toContain('@open-mercato/gateway-tpay')
  })

  it('applies --category, --kind and --limit', async () => {
    const { fetchImpl } = fixtureFetch()
    const io = capture()
    await runModuleSearch(
      ['sync', '--kind', 'module', '--limit=1', '--all-lines', '--json', '--category', 'integrations-sync'],
      deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io),
    )
    const json = JSON.parse(io.stdout.join('\n'))
    expect(json.results).toHaveLength(1)
    expect(json.results[0].category).toBe('integrations-sync')
    expect(json.builtIn).toEqual([])
  })

  it('lists what --category picks without a query', async () => {
    const io = capture()
    const { fetchImpl } = fixtureFetch()
    const code = await runModuleSearch(['--category', 'payments-finance', '--json'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io))
    expect(code).toBe(0)
    const json = JSON.parse(io.stdout.join('\n'))
    expect(json.query).toBe('')
    expect(json.results.map((card: { locator: string }) => card.locator)).toEqual(['npm:@open-mercato/gateway-stripe'])
    expect(json.results[0].matchedOn).toEqual(['category payments-finance'])
    expect(json.builtIn.map((card: { id: string }) => card.id)).toEqual(['currencies'])
    expect(json.hidden).toBe(1)
  })

  it('ignores stop words, so "when a deal is won" lists nothing', async () => {
    const io = capture()
    const { fetchImpl } = fixtureFetch()
    await runModuleSearch(['when a deal is won', '--all-lines'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io))
    expect(io.stdout[0]).toBe('No modules matched "when a deal is won".')
  })

  it('names the spelling it searched when one swap of two letters is undone', async () => {
    const io = capture()
    const { fetchImpl } = fixtureFetch()
    await runModuleSearch(['stirpe'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io))
    expect(io.stdout[0]).toBe('Nothing matched "stirpe". Showing results for "stripe".')
    expect(io.stdout.join('\n')).toContain('@open-mercato/gateway-stripe 0.9.0')
  })

  it('says there is nothing to install where a new app already registers the package or has the core module on', async () => {
    const patch = parity.variants[0]?.patch as ParityPatch
    const app = tempApp({ coreVersion: '0.9.0' })
    const stripe = capture()
    await runModuleSearch(['stripe'], deps(app, fixtureFetch({ patch }).fetchImpl, stripe))
    expect(stripe.stdout).toContain(
      '  install: Nothing to install: a new app already registers gateway_stripe in src/modules.ts. In an app from the empty preset: yarn mercato module add @open-mercato/gateway-stripe@0.9.0',
    )
    const rates = capture()
    await runModuleSearch(['exchange rates'], deps(tempApp({ coreVersion: '0.9.0' }), fixtureFetch({ patch }).fetchImpl, rates))
    expect(rates.stdout[1]).toContain('On in a new app on 0.9: nothing to enable.')
    const info = capture()
    await runModuleInfo(['currencies'], deps(tempApp({ coreVersion: '0.9.0' }), fixtureFetch({ patch }).fetchImpl, info))
    expect(info.stdout).toContain(
      '  On in a new app on 0.9: nothing to enable. In an app from the empty preset: yarn mercato module enable @open-mercato/core --module currencies',
    )
  })

  it('prints usage without a query or a filter', async () => {
    const io = capture()
    expect(await runModuleSearch([], deps(tempApp(), fixtureFetch().fetchImpl, io))).toBe(1)
    expect(io.stderr[0]).toContain('Usage: yarn mercato module search [<query>]')
  })
})

describe('providers, libraries and tools, follow-up steps and the app line', () => {
  const variant = parity.variants.find((item) => item.name === 'adapters, libraries and tools') as (typeof parity.variants)[number]
  const patch = variant.patch

  it.each([
    ['0.8.0', '0.8.0'],
    ['0.10.1-develop.7590.1.abc', '0.10.1-develop.7583.1.0c886d0a14'],
  ])('adds the library an adapter needs to its yarn add on %s', async (coreVersion, version) => {
    const app = tempApp({ coreVersion })
    const human = capture()
    await runModuleSearch(['web research', '--all-lines'], deps(app, fixtureFetch({ patch }).fetchImpl, human))
    expect(human.stdout).toContain(
      `  install: yarn add @open-mercato/web-research@${version} @open-mercato/web-research-model@${version} && yarn generate`,
    )
    const json = capture()
    await runModuleSearch(['web research', '--all-lines', '--json'], deps(app, fixtureFetch({ patch }).fetchImpl, json))
    const model = JSON.parse(json.stdout.join('\n')).results.find(
      (card: { locator: string }) => card.locator === 'npm:@open-mercato/web-research-model',
    )
    expect(model.install).toBe(`yarn add @open-mercato/web-research@${version} @open-mercato/web-research-model@${version}`)
  })

  it('lists providers, libraries and tools on the app line with their status, not as hidden', async () => {
    const app = tempApp({ coreVersion: '0.9.0' })
    const provider = capture()
    await runModuleSearch(['--kind', 'provider'], deps(app, fixtureFetch({ patch }).fetchImpl, provider))
    expect(provider.stdout).toContain('@open-mercato/web-research-model 0.9.0   LISTED · untested on 0.9   official · MIT')
    expect(provider.stdout.join('\n')).not.toContain('Use --all-lines.')

    const query = capture()
    await runModuleSearch(['web research', '--json'], deps(app, fixtureFetch({ patch }).fetchImpl, query))
    const json = JSON.parse(query.stdout.join('\n'))
    expect(json.hidden).toBe(0)
    expect(json.results.map((card: { locator: string }) => card.locator)).toEqual([
      'npm:@open-mercato/web-research',
      'npm:@open-mercato/web-research-model',
    ])
    expect(json.results[0].install).toBe('yarn add @open-mercato/web-research@0.9.0')

    const library = capture()
    await runModuleSearch(['--kind', 'library'], deps(app, fixtureFetch({ patch }).fetchImpl, library))
    expect(library.stdout).toContain('  install: yarn add @open-mercato/web-research@0.9.0 && yarn generate')

    const tool = capture()
    await runModuleSearch(['--kind', 'tool'], deps(app, fixtureFetch({ patch }).fetchImpl, tool))
    expect(tool.stdout).toContain('  install: npx create-mercato-module@0.4.2')
  })

  it('still hides modules not verified on the app line and counts only those', async () => {
    const io = capture()
    await runModuleSearch(['--category', 'payments-finance', '--json'], deps(tempApp({ coreVersion: '0.9.0' }), fixtureFetch({ patch }).fetchImpl, io))
    expect(JSON.parse(io.stdout.join('\n')).hidden).toBe(1)
  })

  it('prints generate after create-mercato-module and db:migrate after a module install that adds tables', async () => {
    const app = tempApp({ coreVersion: '0.9.0' })
    const treg = capture()
    await runModuleInfo(['github:Chmarusso/open-mercato-enrichment-treg'], deps(app, fixtureFetch().fetchImpl, treg))
    expect(treg.stdout).toContain(
      '  install: npx create-mercato-module install Chmarusso/open-mercato-enrichment-treg && yarn generate && yarn db:migrate',
    )
    const ksef = capture()
    await runModuleInfo(['@fastwhitecat/integration-ksef-direct'], deps(app, fixtureFetch().fetchImpl, ksef))
    expect(ksef.stdout).toContain(
      '  install: yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party && yarn db:migrate',
    )
    const stripe = capture()
    await runModuleSearch(['stripe'], deps(app, fixtureFetch().fetchImpl, stripe))
    expect(stripe.stdout).toContain('  install: yarn mercato module add @open-mercato/gateway-stripe@0.9.0')
    const enterprise = capture()
    await runModuleInfo(['@open-mercato/enterprise'], deps(app, fixtureFetch().fetchImpl, enterprise))
    expect(enterprise.stdout.filter((line) => line.startsWith('  install:')).join('\n')).not.toMatch(/yarn generate.*yarn generate/)
    const json = capture()
    await runModuleInfo(['@fastwhitecat/integration-ksef-direct', '--json'], deps(app, fixtureFetch().fetchImpl, json))
    expect(JSON.parse(json.stdout.join('\n')).entry.install.cli).toBe(
      'yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party',
    )
  })

  it('adds the steps once to multi-module, enterprise and empty-preset commands', () => {
    const ksef = index.entries.find((entry) => entry.locator === 'npm:@fastwhitecat/integration-ksef-direct') as CatalogEntry
    const enterprise = index.entries.find((entry) => entry.locator === 'npm:@open-mercato/enterprise') as CatalogEntry
    const several = 'yarn mercato module add x@1.0.0 --module a && yarn mercato module add x@1.0.0 --module b'
    expect(withFollowUpSteps(several, ksef)).toBe(`${several} && yarn db:migrate`)
    const step = 'echo OM_ENABLE_ENTERPRISE_MODULES=true >> .env && yarn generate'
    expect(withFollowUpSteps(step, enterprise)).toBe(`${step} && yarn db:migrate`)
    const migrationsOnly = { ...ksef, anatomy: { version: '1.0.0', counts: { migrations: 2 }, lists: { tables: [] } } }
    expect(withFollowUpSteps('yarn mercato module add x@1.0.0', migrationsOnly)).toBe('yarn mercato module add x@1.0.0 && yarn db:migrate')
    const githubLibrary = { ...ksef, kind: 'library' as const, anatomy: null }
    expect(withFollowUpSteps('npx create-mercato-module install o/r', githubLibrary)).toBe(
      'npx create-mercato-module install o/r && yarn generate',
    )
  })

  it('adds db:migrate to the empty-preset command of a preset note', async () => {
    const patch: ParityPatch = { entries: { 'npm:@fastwhitecat/integration-ksef-direct': { compat: { inPresets: ['0.9'] } } } }
    const io = capture()
    await runModuleSearch(['ksef'], deps(tempApp({ coreVersion: '0.9.0' }), fixtureFetch({ patch }).fetchImpl, io))
    expect(io.stdout).toContain(
      '  install: Nothing to install: a new app already registers integration_ksef_direct in src/modules.ts. In an app from the empty preset: yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party && yarn db:migrate',
    )
  })

  it('reads conditional registrations in src/modules.ts with the injected environment', async () => {
    const modulesTs = [
      "export const enabledModules = [{ id: 'auth', from: '@open-mercato/core' }]",
      "if (process.env.OM_TEST_CURRENCIES) enabledModules.push({ id: 'currencies', from: '@open-mercato/core' })",
      '',
    ].join('\n')
    const app = tempApp({ coreVersion: '0.9.0', modulesTs })
    const off = capture()
    await runModuleSearch(['exchange rates'], deps(app, fixtureFetch().fetchImpl, off))
    expect(off.stdout.join('\n')).not.toContain('Already enabled.')
    const offInfo = capture()
    await runModuleInfo(['currencies'], deps(app, fixtureFetch().fetchImpl, offInfo))
    expect(offInfo.stdout.join('\n')).not.toContain('Already enabled.')

    const env = { OM_TEST_CURRENCIES: 'true' }
    const on = capture()
    await runModuleSearch(['exchange rates'], { ...deps(app, fixtureFetch().fetchImpl, on), env })
    expect(on.stdout[1]).toContain('Already enabled.')
    const onInfo = capture()
    await runModuleInfo(['currencies'], { ...deps(app, fixtureFetch().fetchImpl, onInfo), env })
    expect(onInfo.stdout).toContain('  Already enabled.')
  })

  it('gives module info --json the preset advice of the app line', () => {
    const data = patchedFixture({ builtIn: { currencies: { inPresets: ['0.8', '0.9', 'next'], inEmptyPreset: ['0.9', 'next'] } } })
    const searcher = createCatalogSearcher(data.index, data.builtIn)
    const today = parity.now.slice(0, 10)
    const enable = 'yarn mercato module enable @open-mercato/core --module currencies'

    const older = buildInfoView(searcher, 'currencies', { omVersion: '0.8.0', enabledModules: null }, today)
    if ('error' in older.json) throw new Error('expected a built-in module')
    const presetNote = `On in a new app on 0.8: nothing to enable. In an app from the empty preset: ${enable}`
    expect(older.json.warnings).toEqual(['Built into Open Mercato core as currencies.', presetNote])
    expect(renderInfoHuman(older, searcher)).toContain(`  ${presetNote}`)

    const untested = buildInfoView(searcher, 'currencies', { omVersion: '0.7.4', enabledModules: null }, today)
    if ('error' in untested.json) throw new Error('expected a built-in module')
    expect(untested.json.warnings).toEqual([`Built into Open Mercato core as currencies. Enable it: ${enable}`])
    expect(renderInfoHuman(untested, searcher)).toContain(`  enable: ${enable}`)
  })
})

describe('module search app-root resolution', () => {
  it.each([
    { name: 'search', run: runModuleSearch, directory: '' },
    { name: 'info', run: runModuleInfo, directory: '' },
    { name: 'search', run: runModuleSearch, directory: 'nested/working' },
    { name: 'info', run: runModuleInfo, directory: 'nested/working' },
  ])('uses the resolved app for $name metadata and cache from "$directory"', async ({ run, directory }) => {
    const root = tempApp({ coreVersion: '0.8.0' })
    const app = path.join(root, 'apps', 'mercato')
    fs.mkdirSync(path.join(root, 'packages', 'core', 'src', 'modules'), { recursive: true })
    fs.mkdirSync(path.join(app, 'src'), { recursive: true })
    fs.writeFileSync(path.join(app, 'package.json'), JSON.stringify({ dependencies: { '@open-mercato/core': '^0.9.0' } }))
    fs.writeFileSync(path.join(app, 'src', 'modules.ts'), "export const enabledModules = [{ id: 'currencies', from: '@open-mercato/core' }]")
    const cwd = process.cwd()
    const workingDirectory = path.join(root, directory)
    fs.mkdirSync(workingDirectory, { recursive: true })
    process.chdir(workingDirectory)
    const io = capture()
    try {
      const options = deps(root, fixtureFetch().fetchImpl, io)
      delete options.appRoot
      expect(await run(['currencies', '--json'], options)).toBe(0)
      expect(JSON.parse(io.stdout.join('')).line).toBe('0.9')
      if (run === runModuleSearch) expect(JSON.parse(io.stdout.join('')).builtIn[0].enabled).toBe(true)
      expect(fs.existsSync(path.join(app, MODULE_INDEX_CACHE_FILE))).toBe(true)
      expect(fs.existsSync(path.join(root, MODULE_INDEX_CACHE_FILE))).toBe(false)
    } finally {
      process.chdir(cwd)
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps cwd outside an app and honors an explicit appRoot', async () => {
    const root = tempApp()
    const existsSync = fs.existsSync
    const exists = jest.spyOn(fs, 'existsSync').mockImplementation((file) =>
      String(file).endsWith(path.join('node_modules', '@open-mercato', 'core')) ? false : existsSync(file),
    )
    const explicit = tempApp({ coreVersion: '0.8.0' })
    const cwd = process.cwd()
    process.chdir(root)
    try {
      const io = capture()
      const options = deps(root, fixtureFetch().fetchImpl, io)
      delete options.appRoot
      expect(await runModuleSearch(['stripe', '--json'], options)).toBe(0)
      expect(fs.existsSync(path.join(root, MODULE_INDEX_CACHE_FILE))).toBe(true)
      const override = capture()
      await runModuleSearch(['stripe', '--json'], deps(explicit, fixtureFetch().fetchImpl, override))
      expect(JSON.parse(override.stdout.join('')).line).toBe('0.8')
      expect(fs.existsSync(path.join(explicit, MODULE_INDEX_CACHE_FILE))).toBe(true)
    } finally {
      process.chdir(cwd)
      fs.rmSync(root, { recursive: true, force: true })
      fs.rmSync(explicit, { recursive: true, force: true })
      exists.mockRestore()
    }
  })
})

describe('module index transport bounds', () => {
  it.each(['http://catalog.example/modules.json', 'ftp://localhost/modules.json', 'http://localhost.example/modules.json'])('rejects unsafe URL %s before fetching', async (url) => {
    const fetchImpl = jest.fn(fixtureFetch().fetchImpl)
    await expect(loadIndex({ appRoot: tempApp(), url, fetchImpl })).rejects.toThrow('HTTPS')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['localhost', '127.0.0.1', '[::1]'])('allows local HTTP on %s', async (host) => {
    const loaded = await loadIndex({ appRoot: tempApp(), url: `http://${host}/modules.json`, fetchImpl: fixtureFetch().fetchImpl })
    expect(loaded.source).toBe('network')
  })

  it('validates the built-in override too', async () => {
    const fetchImpl = jest.fn(fixtureFetch().fetchImpl)
    await expect(loadIndex({ appRoot: tempApp(), builtInUrl: 'http://remote.example/built-in.json', fetchImpl })).rejects.toThrow('HTTPS')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('refuses HTTPS downgrades before requesting the redirect target', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => new Response(null, {
      status: 302, headers: { location: 'http://remote.example/modules.json' },
    }))
    await expect(loadIndex({ appRoot: tempApp(), fetchImpl })).rejects.toThrow('HTTPS')
    expect(fetchImpl.mock.calls.every(([url, init]) => url === DEFAULT_MODULES_INDEX_URL && init?.redirect === 'manual')).toBe(true)
  })

  it('follows HTTPS redirects', async () => {
    const fixtures = fixtureFetch().fetchImpl
    const fetchImpl: FetchLike = async (url, init) => url === DEFAULT_MODULES_INDEX_URL
      ? new Response(null, { status: 302, headers: { location: 'https://mirror.example/modules.json' } })
      : fixtures(url, init)
    expect((await loadIndex({ appRoot: tempApp(), fetchImpl })).source).toBe('network')
  })

  it('rejects oversized Content-Length before consuming the body', async () => {
    const cancel = jest.fn()
    const fetchImpl: FetchLike = async () => new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': String(MODULE_INDEX_MAX_BYTES + 1) },
    })
    await expect(loadIndex({ appRoot: tempApp(), fetchImpl })).rejects.toThrow('exceeds')
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it.each([undefined, '1'])('caps streamed bytes regardless of Content-Length (%s), cancels and keeps stale cache', async (length) => {
    const app = tempApp()
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const cache = fs.readFileSync(path.join(app, MODULE_INDEX_CACHE_FILE), 'utf8')
    const cancel = jest.fn()
    const fetchImpl: FetchLike = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MODULE_INDEX_MAX_BYTES))
        controller.enqueue(new Uint8Array(1))
      },
      cancel,
    }), { headers: length ? { 'content-length': length } : {} })
    const loaded = await loadIndex({ appRoot: app, fetchImpl, now: () => NOW + 60 * 60 * 1000 })
    expect(loaded.source).toBe('stale-cache')
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(path.join(app, MODULE_INDEX_CACHE_FILE), 'utf8')).toBe(cache)
  })

  it('accepts a streamed index exactly at the size limit', async () => {
    const serialized = JSON.stringify(index)
    const padded = serialized + ' '.repeat(MODULE_INDEX_MAX_BYTES - Buffer.byteLength(serialized))
    const fetchImpl: FetchLike = async (url) => url.endsWith('/modules.json')
      ? new Response(padded)
      : jsonResponse(200, builtIn)
    expect((await loadIndex({ appRoot: tempApp(), fetchImpl })).source).toBe('network')
  })

  it('bounds redirect loops', async () => {
    const fetchImpl = jest.fn<ReturnType<FetchLike>, Parameters<FetchLike>>(async () => new Response(null, {
      status: 302, headers: { location: DEFAULT_MODULES_INDEX_URL },
    }))
    await expect(loadIndex({ appRoot: tempApp(), fetchImpl })).rejects.toThrow('redirects')
    expect(fetchImpl).toHaveBeenCalledTimes(12)
  })

  it('reports an unsafe override through the normal unavailable exit code', async () => {
    const io = capture()
    const options = { ...deps(tempApp(), fixtureFetch().fetchImpl, io), env: { OM_MODULES_INDEX_URL: 'http://remote.example/modules.json' } }
    expect(await runModuleSearch(['stripe'], options)).toBe(MODULE_INDEX_UNAVAILABLE_EXIT_CODE)
    expect(io.stderr.join(' ')).toContain('HTTPS')
    expect(io.stdout).toEqual([])
  })

  it('applies the cap to the built-in index', async () => {
    const fetchImpl: FetchLike = async (url) => url.endsWith('/modules.json')
      ? jsonResponse(200, index)
      : new Response('too large', { headers: { 'content-length': String(MODULE_INDEX_MAX_BYTES + 1) } })
    const loaded = await loadIndex({ appRoot: tempApp(), fetchImpl })
    expect(loaded.builtIn).toBeNull()
    expect(loaded.builtInUnavailable).toContain('exceeds')
  })
})

describe('module index download and offline cache', () => {
  it('downloads modules.json and built-in.json from modules.openmercato.com and caches them', async () => {
    const app = tempApp()
    const { fetchImpl, calls } = fixtureFetch()
    const loaded = await loadIndex({ appRoot: app, fetchImpl, now: () => NOW })
    expect(loaded.source).toBe('network')
    expect(calls.map((call) => call.url)).toEqual([
      'https://modules.openmercato.com/modules.json',
      'https://modules.openmercato.com/built-in.json',
    ])
    expect(fs.existsSync(path.join(app, MODULE_INDEX_CACHE_FILE))).toBe(true)
    expect(DEFAULT_MODULES_INDEX_URL).toBe('https://modules.openmercato.com/modules.json')
    expect(defaultBuiltInUrl('https://mirror.example.com/catalog/modules.json?x=1')).toBe(
      'https://mirror.example.com/catalog/built-in.json',
    )
  })

  it('serves the cache within 10 minutes without touching the network', async () => {
    const app = tempApp()
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const offline = fixtureFetch({ fail: true })
    const loaded = await loadIndex({ appRoot: app, fetchImpl: offline.fetchImpl, now: () => NOW + 9 * 60 * 1000 })
    expect(loaded.source).toBe('cache')
    expect(offline.calls).toHaveLength(0)
  })

  it('revalidates with the ETag after 10 minutes and keeps the copy on 304', async () => {
    const app = tempApp()
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const revalidate = fixtureFetch({ notModified: true })
    const loaded = await loadIndex({ appRoot: app, fetchImpl: revalidate.fetchImpl, now: () => NOW + 11 * 60 * 1000 })
    expect(loaded.source).toBe('network')
    expect(revalidate.calls[0]?.headers['if-none-match']).toBe('"idx-1"')
    expect(loaded.index.entries).toHaveLength(8)
  })

  it('retries once after a network error', async () => {
    const flaky = fixtureFetch({ failFirst: 1 })
    const loaded = await loadIndex({ appRoot: tempApp(), fetchImpl: flaky.fetchImpl, now: () => NOW })
    expect(loaded.source).toBe('network')
    expect(flaky.calls.filter((call) => call.url.endsWith('/modules.json'))).toHaveLength(2)
  })

  it('falls back to the stale cache offline and says so', async () => {
    const app = tempApp({ coreVersion: '0.9.0' })
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const io = capture()
    const code = await runModuleSearch(['ksef'], deps(app, fixtureFetch({ fail: true }).fetchImpl, io, NOW + 60 * 60 * 1000))
    expect(code).toBe(0)
    expect(io.stderr).toEqual([`Using cached module index from ${new Date(NOW).toISOString()}.`])
    expect(io.stdout[0]).toContain('@fastwhitecat/integration-ksef-direct 0.1.8')
  })

  it('keeps the cached copy when a new index is malformed or cannot be searched', async () => {
    const app = tempApp({ coreVersion: '0.9.0' })
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const cacheFile = path.join(app, MODULE_INDEX_CACHE_FILE)
    const healthy = fs.readFileSync(cacheFile, 'utf8')
    const body = readFixture('modules-index.json') as CatalogIndex
    const [first] = body.entries as [CatalogEntry]
    const responses = [
      { ...body, entries: body.entries.map((entry) => (entry === first ? { ...entry, providers: [null] } : entry)) },
      // passes validation, but MiniSearch refuses a second document with the same locator
      { ...body, entries: [...body.entries, first] },
    ]
    for (const response of responses) {
      const fetchImpl: FetchLike = async (url) =>
        url.endsWith('/modules.json') ? jsonResponse(200, response, '"idx-2"') : jsonResponse(200, readFixture('built-in.json'), '"bi-1"')
      const io = capture()
      const code = await runModuleSearch(['ksef'], deps(app, fetchImpl, io, NOW + 60 * 60 * 1000))
      expect(code).toBe(0)
      expect(io.stderr).toEqual([`Using cached module index from ${new Date(NOW).toISOString()}.`])
      expect(io.stdout[0]).toContain('@fastwhitecat/integration-ksef-direct 0.1.8')
      expect(fs.readFileSync(cacheFile, 'utf8')).toBe(healthy)
    }
  })

  it('downloads a new copy when the cached one was written with fields this CLI cannot read', async () => {
    const app = tempApp()
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const cacheFile = path.join(app, MODULE_INDEX_CACHE_FILE)
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
    cache.index.entries[0].providers = [null]
    fs.writeFileSync(cacheFile, JSON.stringify(cache))
    const { fetchImpl, calls } = fixtureFetch()
    const loaded = await loadIndex({ appRoot: app, fetchImpl, now: () => NOW + 60 * 1000 })
    expect(loaded.source).toBe('network')
    expect(calls[0]?.headers['if-none-match']).toBeUndefined()
    expect(loaded.searcher.modules.size).toBeGreaterThan(0)
  })

  it('exits with code 2 and a readable message offline without a cache', async () => {
    const io = capture()
    const code = await runModuleSearch(['ksef', '--json'], deps(tempApp(), fixtureFetch({ fail: true }).fetchImpl, io))
    expect(code).toBe(MODULE_INDEX_UNAVAILABLE_EXIT_CODE)
    expect(io.stderr).toEqual([MODULE_INDEX_UNAVAILABLE_MESSAGE, 'Reason: getaddrinfo ENOTFOUND modules.openmercato.com'])
    expect(io.stdout).toEqual([])
  })

  it('names the URL and the HTTP status when OM_MODULES_INDEX_URL points to a missing file', async () => {
    const io = capture()
    const options = { ...deps(tempApp(), fixtureFetch().fetchImpl, io), env: { OM_MODULES_INDEX_URL: 'https://mirror.example.com/nope.json' } }
    const code = await runModuleSearch(['ksef'], options)
    expect(code).toBe(MODULE_INDEX_UNAVAILABLE_EXIT_CODE)
    expect(io.stderr).toEqual([MODULE_INDEX_UNAVAILABLE_MESSAGE, 'Reason: https://mirror.example.com/nope.json answered 404'])
  })

  it('says so when built-in.json is missing and asks for it again on the next run', async () => {
    const app = tempApp({ coreVersion: '0.9.0' })
    const io = capture()
    const code = await runModuleSearch(['exchange rates', '--json'], deps(app, fixtureFetch({ noBuiltIn: true }).fetchImpl, io))
    expect(code).toBe(0)
    expect(io.stderr).toEqual([BUILT_IN_UNAVAILABLE_MESSAGE, 'Reason: https://modules.openmercato.com/built-in.json answered 404'])
    const json = JSON.parse(io.stdout.join('\n'))
    expect(json.builtInUnavailable).toBe(true)
    expect(json.builtIn).toEqual([])

    const next = fixtureFetch()
    const again = capture()
    await runModuleSearch(['exchange', 'rates'], deps(app, next.fetchImpl, again, NOW + 60 * 1000))
    expect(next.calls.map((call) => call.url)).toContain('https://modules.openmercato.com/built-in.json')
    expect(again.stderr).toEqual([])
    expect(again.stdout[0]).toBe('Already in Open Mercato core:')
  })

  it('keeps the cached built-in list when only built-in.json fails', async () => {
    const app = tempApp()
    await loadIndex({ appRoot: app, fetchImpl: fixtureFetch().fetchImpl, now: () => NOW })
    const loaded = await loadIndex({
      appRoot: app,
      fetchImpl: fixtureFetch({ noBuiltIn: true }).fetchImpl,
      now: () => NOW + 11 * 60 * 1000,
    })
    expect(loaded.source).toBe('network')
    expect(loaded.builtIn).not.toBeNull()
    expect(loaded.builtInUnavailable).toBeNull()
  })

  it('reads OM_MODULES_INDEX_URL', async () => {
    const io = capture()
    const { fetchImpl, calls } = fixtureFetch()
    await runModuleSearch(['ksef', '--json'], {
      ...deps(tempApp(), fetchImpl, io),
      env: { OM_MODULES_INDEX_URL: 'https://mirror.example.com/om/modules.json' },
    })
    expect(calls[0]?.url).toBe('https://mirror.example.com/om/modules.json')
    expect(calls[1]?.url).toBe('https://mirror.example.com/om/built-in.json')
  })
})

describe('yarn mercato module info', () => {
  it('prints the card, line statuses, agent policy and install command', async () => {
    const io = capture()
    const code = await runModuleInfo(
      ['@fastwhitecat/integration-ksef-direct'],
      deps(tempApp({ coreVersion: '0.9.0' }), fixtureFetch().fetchImpl, io),
    )
    expect(code).toBe(0)
    const text = io.stdout.join('\n')
    expect(text).toContain('@fastwhitecat/integration-ksef-direct 0.1.8   VERIFIED · 0.9   3rd-party · MIT')
    expect(text).toContain('lines: 0.9 verified · 0.8 untested · next verified')
    expect(text).toContain('agent policy on 0.9: ask')
    expect(text).toContain('install: yarn mercato module add @fastwhitecat/integration-ksef-direct@0.1.8 --allow-third-party')
    expect(text).toContain('install plan: https://modules.openmercato.com/m/@fastwhitecat/integration-ksef-direct.md')
  })

  it('returns the get_module shape with --json', async () => {
    const io = capture()
    await runModuleInfo(['integration_ksef_direct', '--json'], deps(tempApp(), fixtureFetch().fetchImpl, io))
    const json = JSON.parse(io.stdout.join('\n'))
    expect(Object.keys(json).sort()).toEqual(['anatomy', 'candidates', 'card', 'entry', 'line', 'schemaVersion', 'untrusted', 'warnings'])
    expect(json.entry.locator).toBe('npm:@fastwhitecat/integration-ksef-direct')
  })

  it('points built-in module ids to module enable', async () => {
    const io = capture()
    await runModuleInfo(['currencies'], deps(tempApp(), fixtureFetch().fetchImpl, io))
    expect(io.stdout[0]).toBe('currencies is built into Open Mercato core: Currencies.')
    expect(io.stdout.join('\n')).toContain('enable: yarn mercato module enable @open-mercato/core --module currencies')
  })

  it('exits with 1 and candidates for an unknown module', async () => {
    const io = capture()
    const code = await runModuleInfo(['stripe'], deps(tempApp(), fixtureFetch().fetchImpl, io))
    expect(code).toBe(1)
    expect(io.stderr).toEqual(['Unknown module "stripe". Did you mean: npm:@open-mercato/gateway-stripe?'])
  })
})

describe('argument parsing', () => {
  it('joins words into one query and reads flags in both forms', () => {
    expect(parseModuleSearchArgs(['exchange', 'rates', '--limit', '5', '--kind=module,built-in', '--json'])).toEqual({
      query: 'exchange rates',
      category: null,
      kinds: ['module', 'built-in'],
      allLines: false,
      limit: 5,
      json: true,
    })
    expect(parseModuleSearchArgs(['ksef', '--category=payments-finance', '--all-lines'])).toMatchObject({
      category: 'payments-finance',
      allLines: true,
      limit: 10,
    })
  })

  it('rejects bad values', () => {
    expect(() => parseModuleSearchArgs(['x', '--limit', '0'])).toThrow('--limit must be a whole number between 1 and 20')
    expect(() => parseModuleSearchArgs(['x', '--limit', '21'])).toThrow('--limit must be a whole number between 1 and 20')
    expect(() => parseModuleSearchArgs(['x', '--kind', 'plugin'])).toThrow('--kind must be one of')
    expect(() => parseModuleSearchArgs(['x', '--category'])).toThrow('--category requires a value')
    expect(() => parseModuleSearchArgs(['x', '--json=1'])).toThrow('--json does not accept a value')
    expect(() => parseModuleSearchArgs(['x', '--verbose'])).toThrow('Unsupported option: --verbose')
    expect(() => parseModuleSearchArgs(['x'.repeat(201)])).toThrow('longer than 200 characters')
  })

  it('takes one ref for module info', () => {
    expect(parseModuleInfoArgs(['@acme/foo@1.2.3', '--json'])).toEqual({ ref: '@acme/foo@1.2.3', json: true })
    expect(parseModuleInfoArgs([])).toEqual({ ref: null, json: false })
    expect(() => parseModuleInfoArgs(['a', 'b'])).toThrow('module info takes one package name or module id')
  })
})
