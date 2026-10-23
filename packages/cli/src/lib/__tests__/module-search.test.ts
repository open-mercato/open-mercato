import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseModuleInfoArgs, parseModuleSearchArgs } from '../module-search-args'
import {
  createCatalogSearcher,
  resolveLine,
  searchModules,
  type BuiltInIndex,
  type CatalogIndex,
  type SearchModulesInput,
  type SearchModulesOutput,
} from '../module-search-index'
import {
  buildInfoView,
  DEFAULT_MODULES_INDEX_URL,
  defaultBuiltInUrl,
  loadIndex,
  MODULE_INDEX_CACHE_FILE,
  MODULE_INDEX_UNAVAILABLE_EXIT_CODE,
  MODULE_INDEX_UNAVAILABLE_MESSAGE,
  parseBuiltInIndex,
  parseCatalogIndex,
  runModuleInfo,
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

const parity = readFixture('catalog-parity.json') as {
  now: string
  search: { input: SearchModulesInput; output: SearchModulesOutput }[]
  info: ParityInfo[]
}

const BUILT_IN_CARD_KEYS = ['category', 'description', 'enabled', 'id', 'install', 'matchedOn', 'page', 'title']
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
    json: async () => body,
  }
}

type FetchCall = { url: string; headers: Record<string, string> }

function fixtureFetch(options: { fail?: boolean; failFirst?: number; notModified?: boolean } = {}) {
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
    if (url.endsWith('/modules.json')) return jsonResponse(200, readFixture('modules-index.json'), '"idx-1"')
    if (url.endsWith('/built-in.json')) return jsonResponse(200, readFixture('built-in.json'), '"bi-1"')
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
})

describe('parity with the catalog search_modules tool (tools@1)', () => {
  const searcher = createCatalogSearcher(index, builtIn)

  it.each(parity.search.map((item) => [JSON.stringify(item.input), item] as const))('%s', (_label, item) => {
    expect(searchModules(searcher, item.input)).toEqual(item.output)
  })

  it.each(GOLDEN_IN_FIXTURE)('golden query "%s" keeps its expected result in the top 3', (query, modules, builtIns) => {
    const result = searchModules(searcher, { query })
    const top = result.results.slice(0, 3).map((card) => card.locator.replace(/^npm:/, ''))
    const topBuiltIn = result.builtIn.slice(0, 3).map((card) => card.id)
    for (const name of modules) expect(top).toContain(name)
    for (const id of builtIns) expect(topBuiltIn).toContain(id)
  })
})

describe('parity with the catalog get_module tool (tools@1)', () => {
  const searcher = createCatalogSearcher(index, builtIn)
  const today = parity.now.slice(0, 10)

  it.each(parity.info.map((item) => [item.ref, item] as const))('%s', (ref, expected) => {
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

describe('yarn mercato module search', () => {
  it('prints the tools@1 contract for "ksef" --json', async () => {
    const io = capture()
    const { fetchImpl } = fixtureFetch()
    const code = await runModuleSearch(['ksef', '--json'], deps(tempApp({ coreVersion: '0.9.0' }), fetchImpl, io))
    expect(code).toBe(0)
    const json = JSON.parse(io.stdout.join('\n'))
    expect(Object.keys(json).sort()).toEqual(
      ['builtIn', 'dataVersion', 'generatedAt', 'hidden', 'line', 'omVersion', 'query', 'results', 'schemaVersion', 'total'],
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

  it('prints usage without a query', async () => {
    const io = capture()
    expect(await runModuleSearch([], deps(tempApp(), fixtureFetch().fetchImpl, io))).toBe(1)
    expect(io.stderr[0]).toContain('Usage: yarn mercato module search <query>')
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

  it('exits with code 2 and a readable message offline without a cache', async () => {
    const io = capture()
    const code = await runModuleSearch(['ksef', '--json'], deps(tempApp(), fixtureFetch({ fail: true }).fetchImpl, io))
    expect(code).toBe(MODULE_INDEX_UNAVAILABLE_EXIT_CODE)
    expect(io.stderr).toEqual([MODULE_INDEX_UNAVAILABLE_MESSAGE])
    expect(io.stdout).toEqual([])
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
