import fs from 'node:fs'
import path from 'node:path'
import type { ModuleEntry } from './modules-config'
import {
  builtInEnableCommand,
  builtInWarning,
  cardUrl,
  CORE_PACKAGE,
  createCatalogSearcher,
  entryWarnings,
  installCommand,
  installVersion,
  latestLine,
  rankModules,
  resolveLine,
  resolveRef,
  sharedModuleIdWarning,
  statusOn,
  stripVersion,
  toModuleCard,
  unknownModuleMessage,
  type AgentPolicy,
  type BuiltInCard,
  type BuiltInIndex,
  type BuiltInModule,
  type CatalogEntry,
  type CatalogIndex,
  type CatalogSearcher,
  type ModuleCard,
} from './module-search-index'
import { parseModuleInfoArgs, parseModuleSearchArgs } from './module-search-args'

export const DEFAULT_MODULES_INDEX_URL = 'https://modules.openmercato.com/modules.json'
export const MODULES_SITE_URL = 'https://modules.openmercato.com'
export const MODULE_INDEX_TIMEOUT_MS = 4000
export const MODULE_INDEX_TTL_MS = 10 * 60 * 1000
export const MODULE_INDEX_CACHE_FILE = path.join('.mercato', 'cache', 'modules-index.json')
export const MODULE_INDEX_UNAVAILABLE_EXIT_CODE = 2
export const MODULE_INDEX_UNAVAILABLE_MESSAGE =
  'Module index unavailable. Check your connection or set OM_MODULES_INDEX_URL.'

export type FetchResponseLike = {
  status: number
  ok: boolean
  headers: { get(name: string): string | null }
  json(): Promise<unknown>
}

export type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<FetchResponseLike>

export type LoadedModuleIndex = {
  index: CatalogIndex
  builtIn: BuiltInIndex | null
  /** Why the built-in module list is missing (`builtIn` is null), or null when it loaded. */
  builtInUnavailable: string | null
  source: 'network' | 'cache' | 'stale-cache'
  fetchedAt: string
  searcher: CatalogSearcher
}

export type LoadIndexOptions = {
  appRoot: string
  url?: string
  builtInUrl?: string
  timeoutMs?: number
  ttlMs?: number
  fetchImpl?: FetchLike
  now?: () => number
}

type CacheFile = {
  cacheVersion: 1
  url: string
  builtInUrl: string
  fetchedAt: string
  etag: string | null
  builtInEtag: string | null
  index: CatalogIndex
  builtIn: BuiltInIndex | null
}

export class ModuleIndexUnavailableError extends Error {
  readonly detail: string

  constructor(detail: string) {
    super(`${MODULE_INDEX_UNAVAILABLE_MESSAGE} (${detail})`)
    this.name = 'ModuleIndexUnavailableError'
    this.detail = detail
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === 'string'
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every(isString)
const isNullableString = (value: unknown): value is string | null => value === null || isString(value)
const isArrayOf = (value: unknown, item: (value: unknown) => boolean): boolean => Array.isArray(value) && value.every(item)
const isRecordOf = (value: unknown, item: (value: unknown) => boolean): boolean =>
  isRecord(value) && Object.values(value).every(item)
const isAbsentOr = (value: unknown, check: (value: unknown) => boolean): boolean => value === undefined || check(value)

const ANATOMY_LISTS = ['aclFeatures', 'eventsEmitted', 'eventsConsumed', 'env', 'hosts', 'tables', 'publicRoutes'] as const

// The anatomy lists search indexes and `module info` prints; a module without anatomy has null.
function isAnatomy(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (!isRecord(value)) return false
  const lists = value.lists
  if (lists === undefined) return true
  return (
    isRecord(lists) &&
    ANATOMY_LISTS.every((key) => isAbsentOr(lists[key], isStringArray)) &&
    isAbsentOr(lists.credentials, (credentials) =>
      isArrayOf(credentials, (credential) => isRecord(credential) && isString(credential.key)),
    )
  )
}

function isAgentPolicy(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.decision) &&
    isArrayOf(value.reasons, (reason) => isRecord(reason) && isString(reason.code) && isString(reason.text))
  )
}

function isSignals(value: unknown): boolean {
  if (value === null || value === undefined) return true
  return (
    isRecord(value) &&
    isAbsentOr(value.supplyChain, (item) => isRecord(item) && isString(item.status) && isStringArray(item.reasons)) &&
    isAbsentOr(value.hygiene, (item) => isRecord(item) && isString(item.status) && isStringArray(item.failing)) &&
    isAbsentOr(value.anatomy, isString)
  )
}

// Every field search, `module info` and their output read, nested ones too: an entry that passes is never the reason
// a command throws, so a malformed index is refused before it can replace a working cached copy.
function isCatalogEntry(value: unknown): value is CatalogEntry {
  if (!isRecord(value)) return false
  const version = value.version
  const compat = value.compat
  const install = value.install
  const links = value.links
  const license = value.license
  return (
    isString(value.locator) &&
    isString(value.path) &&
    (value.npm === null || isString(value.npm)) &&
    isString(value.title) &&
    isString(value.summary) &&
    isString(value.whenToUse) &&
    isString(value.type) &&
    isString(value.kind) &&
    isString(value.category) &&
    isStringArray(value.tags) &&
    isArrayOf(value.providers, (provider) => isRecord(provider) && isString(provider.name) && isString(provider.label)) &&
    isStringArray(value.moduleIds) &&
    isStringArray(value.renamedFrom) &&
    isString(value.status) &&
    typeof value.listed === 'boolean' &&
    isNullableString(value.tier) &&
    isRecord(license) &&
    isNullableString(license.spdx) &&
    isString(license.kind) &&
    isRecord(version) &&
    isNullableString(version.latest) &&
    isNullableString(version.preview) &&
    isNullableString(version.installableFrom) &&
    isNullableString(version.gitRef) &&
    isRecordOf(version.recommended, isNullableString) &&
    isRecord(compat) &&
    isRecordOf(compat.lines, (cell) => isRecord(cell) && isString(cell.status)) &&
    isStringArray(compat.verifiedOn) &&
    isAnatomy(value.anatomy) &&
    isSignals(value.signals) &&
    isRecordOf(value.agentPolicy, isAgentPolicy) &&
    isRecord(install) &&
    isString(install.cli) &&
    isAbsentOr(install.moduleFlag, isNullableString) &&
    isRecord(links) &&
    isString(links.page) &&
    isString(links.md)
  )
}

export function parseCatalogIndex(value: unknown): CatalogIndex | null {
  if (!isRecord(value) || value.schemaVersion !== 1) return null
  if (!isString(value.generatedAt) || !isString(value.dataVersion) || !isString(value.site)) return null
  if (!Array.isArray(value.lines) || !Array.isArray(value.entries)) return null
  const lines = value.lines.filter(
    (line): line is CatalogIndex['lines'][number] =>
      isRecord(line) &&
      isString(line.key) &&
      isString(line.version) &&
      (line.source === 'latest' || line.source === 'previous' || line.source === 'develop'),
  )
  if (lines.length !== value.lines.length) return null
  if (!value.entries.every(isCatalogEntry)) return null
  return value as CatalogIndex
}

export function parseBuiltInIndex(value: unknown): BuiltInIndex | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isString(value.coreVersion) || !Array.isArray(value.modules)) {
    return null
  }
  const valid = value.modules.every(
    (coreModule) =>
      isRecord(coreModule) &&
      isString(coreModule.id) &&
      isString(coreModule.title) &&
      isString(coreModule.description) &&
      isString(coreModule.category) &&
      isString(coreModule.install) &&
      isString(coreModule.page) &&
      isAbsentOr(coreModule.requires, isStringArray) &&
      isAbsentOr(coreModule.inPresets, isStringArray) &&
      isAnatomy(coreModule.anatomy),
  )
  return valid ? (value as BuiltInIndex) : null
}

function parseCacheFile(value: unknown): CacheFile | null {
  if (!isRecord(value) || value.cacheVersion !== 1) return null
  if (!isString(value.url) || !isString(value.builtInUrl) || !isString(value.fetchedAt)) return null
  const index = parseCatalogIndex(value.index)
  if (!index) return null
  const builtIn = value.builtIn === null ? null : parseBuiltInIndex(value.builtIn)
  return {
    cacheVersion: 1,
    url: value.url,
    builtInUrl: value.builtInUrl,
    fetchedAt: value.fetchedAt,
    etag: isString(value.etag) ? value.etag : null,
    builtInEtag: isString(value.builtInEtag) ? value.builtInEtag : null,
    index,
    builtIn,
  }
}

export function defaultBuiltInUrl(indexUrl: string): string {
  const url = new URL(indexUrl)
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/[^/]*$/, 'built-in.json')
  return url.toString()
}

function readCache(file: string): CacheFile | null {
  try {
    return parseCacheFile(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

function writeCache(file: string, cache: CacheFile): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    fs.writeFileSync(temporary, JSON.stringify(cache))
    fs.renameSync(temporary, file)
  } catch {
    return
  }
}

async function fetchOnce(
  fetchImpl: FetchLike,
  url: string,
  etag: string | null,
  timeoutMs: number,
): Promise<FetchResponseLike> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (etag) headers['if-none-match'] = etag
  return fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) })
}

async function fetchWithRetry(
  fetchImpl: FetchLike,
  url: string,
  etag: string | null,
  timeoutMs: number,
): Promise<FetchResponseLike> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetchOnce(fetchImpl, url, etag, timeoutMs)
      if (response.status >= 500) {
        lastError = new Error(`${url} answered ${response.status}`)
        continue
      }
      return response
    } catch (error: unknown) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function fetchJson<T>(
  fetchImpl: FetchLike,
  url: string,
  etag: string | null,
  timeoutMs: number,
  parse: (value: unknown) => T | null,
): Promise<{ notModified: true } | { notModified: false; value: T; etag: string | null }> {
  const response = await fetchWithRetry(fetchImpl, url, etag, timeoutMs)
  if (response.status === 304) return { notModified: true }
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  const value = parse(await response.json())
  if (value === null) throw new Error(`${url} is not a module index this CLI understands`)
  return { notModified: false, value, etag: response.headers.get('etag') }
}

function searcherOf(index: CatalogIndex, builtIn: BuiltInIndex | null): CatalogSearcher | null {
  try {
    return createCatalogSearcher(index, builtIn)
  } catch {
    return null
  }
}

export async function loadIndex(options: LoadIndexOptions): Promise<LoadedModuleIndex> {
  const url = options.url ?? DEFAULT_MODULES_INDEX_URL
  const builtInUrl = options.builtInUrl ?? defaultBuiltInUrl(url)
  const timeoutMs = options.timeoutMs ?? MODULE_INDEX_TIMEOUT_MS
  const ttlMs = options.ttlMs ?? MODULE_INDEX_TTL_MS
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init))
  const now = options.now ?? (() => Date.now())
  const cacheFile = path.join(options.appRoot, MODULE_INDEX_CACHE_FILE)
  const cached = readCache(cacheFile)
  let usable = cached && cached.url === url && cached.builtInUrl === builtInUrl ? cached : null

  // a copy without the built-in list is not fresh: the next run asks for built-in.json again
  if (usable && usable.builtIn && now() - Date.parse(usable.fetchedAt) < ttlMs) {
    const searcher = searcherOf(usable.index, usable.builtIn)
    if (searcher) {
      return { index: usable.index, builtIn: usable.builtIn, builtInUnavailable: null, source: 'cache', fetchedAt: usable.fetchedAt, searcher }
    }
    // a copy this CLI cannot search is no copy: download a new one
    usable = null
  }

  try {
    const indexResult = await fetchJson(fetchImpl, url, usable?.etag ?? null, timeoutMs, parseCatalogIndex)
    let index: CatalogIndex
    let etag: string | null
    if (indexResult.notModified) {
      if (!usable) throw new Error(`${url} answered 304 without a cached copy`)
      index = usable.index
      etag = usable.etag
    } else {
      index = indexResult.value
      etag = indexResult.etag
    }
    let builtIn = usable?.builtIn ?? null
    let builtInEtag = usable?.builtInEtag ?? null
    let builtInUnavailable: string | null = null
    try {
      const builtInResult = await fetchJson(
        fetchImpl,
        builtInUrl,
        usable?.builtIn ? builtInEtag : null,
        timeoutMs,
        parseBuiltInIndex,
      )
      if (!builtInResult.notModified) {
        builtIn = builtInResult.value
        builtInEtag = builtInResult.etag
      }
    } catch (error: unknown) {
      builtIn = usable?.builtIn ?? null
      if (!builtIn) builtInUnavailable = error instanceof Error ? error.message : String(error)
    }
    // built before the copy is saved, so an index the CLI cannot search never replaces one it can
    const searcher = createCatalogSearcher(index, builtIn)
    const fetchedAt = new Date(now()).toISOString()
    writeCache(cacheFile, {
      cacheVersion: 1,
      url,
      builtInUrl,
      fetchedAt,
      etag,
      builtInEtag,
      index,
      builtIn,
    })
    return { index, builtIn, builtInUnavailable, source: 'network', fetchedAt, searcher }
  } catch (error: unknown) {
    const searcher = usable ? searcherOf(usable.index, usable.builtIn) : null
    if (usable && searcher) {
      return {
        index: usable.index,
        builtIn: usable.builtIn,
        builtInUnavailable: usable.builtIn ? null : 'the cached copy has no built-in module list',
        source: 'stale-cache',
        fetchedAt: usable.fetchedAt,
        searcher,
      }
    }
    const detail = error instanceof Error ? error.message : String(error)
    throw new ModuleIndexUnavailableError(detail)
  }
}

export type AppContext = {
  omVersion: string | null
  enabledModules: ModuleEntry[] | null
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export function detectAppLine(appRoot: string): string | null {
  const installed = readJsonFile(path.join(appRoot, 'node_modules', '@open-mercato', 'core', 'package.json'))
  if (isRecord(installed) && isString(installed.version)) return installed.version
  const manifest = readJsonFile(path.join(appRoot, 'package.json'))
  if (!isRecord(manifest)) return null
  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = manifest[field]
    if (isRecord(deps) && isString(deps[CORE_PACKAGE])) {
      const range = deps[CORE_PACKAGE].trim()
      const match = /\d+\.\d+(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/.exec(range)
      return match ? match[0] : null
    }
  }
  return null
}

export type ReadEnabledModules = (modulesPath: string) => ModuleEntry[]

export function detectAppContext(appRoot: string, readEnabled: ReadEnabledModules | null): AppContext {
  const modulesPath = path.join(appRoot, 'src', 'modules.ts')
  let enabledModules: ModuleEntry[] | null = null
  if (readEnabled && fs.existsSync(modulesPath)) {
    try {
      enabledModules = readEnabled(modulesPath)
    } catch {
      enabledModules = null
    }
  }
  return { omVersion: detectAppLine(appRoot), enabledModules }
}

export type ModuleSearchJson = {
  schemaVersion: 1
  query: string
  line: string | null
  omVersion: string | null
  results: ModuleCard[]
  builtIn: BuiltInCard[]
  /** Present (true) when the built-in module list could not be loaded, so `builtIn` may miss modules core has. */
  builtInUnavailable?: true
  total: number
  hidden: number
  dataVersion: string
  generatedAt: string
}

export type ModuleSearchView = {
  json: ModuleSearchJson
  entries: Map<string, CatalogEntry>
  lineNote: string | null
  allLines: boolean
}

export type ModuleSearchRequest = {
  query: string
  category?: string | null
  kinds?: ('module' | 'provider' | 'library' | 'tool' | 'built-in')[] | null
  allLines?: boolean
  limit?: number
}

function builtInEnabled(id: string, enabled: ModuleEntry[] | null): boolean | null {
  if (!enabled) return null
  return enabled.some((coreModule) => coreModule.id === id && (coreModule.from ?? CORE_PACKAGE) === CORE_PACKAGE)
}

export function buildSearchView(
  searcher: CatalogSearcher,
  request: ModuleSearchRequest,
  app: AppContext,
): ModuleSearchView {
  const resolved = app.omVersion ? resolveLine(app.omVersion, searcher.index.lines) : null
  const ranked = rankModules(searcher, {
    query: request.query,
    ...(app.omVersion ? { omVersion: app.omVersion } : {}),
    ...(request.category ? { category: request.category } : {}),
    ...(request.kinds ? { kind: request.kinds } : {}),
  })
  const line = ranked.line
  const allLines = request.allLines === true || line === null
  const kept = ranked.modules.filter((hit) => allLines || (line !== null && Boolean(hit.meta.entry.version.recommended[line])))
  const limit = Math.min(20, Math.max(1, Math.floor(request.limit ?? 10)))
  const results = kept.slice(0, limit).map((hit) => toModuleCard(searcher, hit, line, ranked.latest))
  const entries = new Map<string, CatalogEntry>()
  for (const hit of kept.slice(0, limit)) entries.set(hit.meta.entry.locator, hit.meta.entry)
  const builtIn = ranked.builtIn.map((card) => ({ ...card, enabled: builtInEnabled(card.id, app.enabledModules) }))
  const lineNote =
    resolved && resolved.line === null
      ? `Open Mercato ${app.omVersion} is not a line the catalog tests (${resolved.note ?? 'unknown version'}). Showing modules for every line.`
      : null
  return {
    json: {
      schemaVersion: 1,
      query: request.query,
      line,
      omVersion: app.omVersion,
      results,
      builtIn,
      total: ranked.modules.length,
      hidden: ranked.modules.length - kept.length,
      dataVersion: searcher.index.dataVersion,
      generatedAt: searcher.index.generatedAt,
    },
    entries,
    lineNote,
    allLines,
  }
}

const ORIGIN_LABEL: Record<string, string> = { official: 'official', community: 'community', '3rd-party': '3rd-party' }

function levelLabel(entry: CatalogEntry, line: string | null): string {
  const level = entry.quality ? 'OM QUALITY' : entry.tier === 'verified' ? 'VERIFIED' : 'LISTED'
  if (line === null) return level
  const status = statusOn(entry, line)
  return status === 'verified' ? `${level} · ${line}` : `${level} · ${status} on ${line}`
}

function policyLabel(policy: AgentPolicy | null): string | null {
  if (!policy) return null
  const reasons = policy.reasons.slice(0, 2).map((reason) => reason.code.toLowerCase().replace(/_/g, '-'))
  return reasons.length > 0 ? `${policy.decision} (${reasons.join(', ')})` : policy.decision
}

function licenseLabel(entry: CatalogEntry): string {
  return entry.license.spdx ?? entry.license.kind
}

function entryHeading(entry: CatalogEntry, line: string | null): string {
  const name = entry.npm ?? entry.locator.replace(/^github:/, '')
  const version = installVersion(entry, line)
  const origin = ORIGIN_LABEL[entry.type] ?? entry.type
  return `${name}${version ? ` ${version}` : ''}   ${levelLabel(entry, line)}   ${origin} · ${licenseLabel(entry)}`
}

/** `today` (YYYY-MM-DD) decides whether `installable from` is still ahead (Yarn age gate). */
export function renderSearchHuman(view: ModuleSearchView, today: string = new Date().toISOString().slice(0, 10)): string[] {
  const { json } = view
  const out: string[] = []
  if (view.lineNote) out.push(view.lineNote, '')
  if (json.builtIn.length > 0) {
    out.push('Already in Open Mercato core:')
    const idWidth = Math.max(...json.builtIn.map((card) => card.id.length))
    const titleWidth = Math.max(...json.builtIn.map((card) => card.title.length))
    for (const card of json.builtIn) {
      const action = card.enabled ? 'Already enabled.' : card.install
      out.push(`  ${card.id.padEnd(idWidth)}  ${card.title.padEnd(titleWidth)}   ${action}`)
    }
    out.push('')
  }
  for (const card of json.results) {
    const entry = view.entries.get(card.locator)
    if (!entry) continue
    out.push(entryHeading(entry, json.line))
    if (card.summary) out.push(`  ${card.summary}`)
    const details = [
      card.matchedOn.length > 0 ? `matched: ${card.matchedOn.join(', ')}` : null,
      policyLabel(card.agentPolicy) ? `agent policy: ${policyLabel(card.agentPolicy)}` : null,
    ].filter((item): item is string => item !== null)
    if (details.length > 0) out.push(`  ${details.join(' · ')}`)
    if (card.installableFrom && card.installableFrom > today && card.status !== 'verified') {
      out.push(`  installable from: ${card.installableFrom}`)
    }
    out.push(`  install: ${card.install}`)
    out.push(`  more: ${card.card}`)
    out.push('')
  }
  const hiddenLine =
    json.hidden > 0 && json.line !== null
      ? json.hidden === 1
        ? `1 more module is listed but not verified on ${json.line}. Use --all-lines.`
        : `${json.hidden} more modules are listed but not verified on ${json.line}. Use --all-lines.`
      : null
  if (json.results.length === 0 && json.builtIn.length === 0) {
    out.push(hiddenLine ? `No modules verified on ${json.line} matched "${json.query}".` : `No modules matched "${json.query}".`)
    if (hiddenLine) out.push(hiddenLine)
    out.push(`Browse the catalog: ${MODULES_SITE_URL}`)
  } else if (hiddenLine) {
    out.push(hiddenLine)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out
}

export type ModuleInfoJson =
  | {
      schemaVersion: 1
      line: string | null
      entry: CatalogEntry | null
      candidates: string[]
      anatomy: null
      warnings: string[]
      untrusted: null
      card: string | null
    }
  | { schemaVersion: 1; error: string; candidates: string[] }

export type ModuleInfoView = {
  json: ModuleInfoJson
  builtIn: BuiltInModule | null
  builtInEnabled: boolean | null
  found: boolean
}

export function buildInfoView(searcher: CatalogSearcher, ref: string, app: AppContext, today: string): ModuleInfoView {
  const builtInModules = searcher.builtIn?.modules ?? []
  const entries = searcher.index.entries
  const latest = latestLine(searcher.index.lines)?.key ?? null
  const line = app.omVersion ? resolveLine(app.omVersion, searcher.index.lines).line : latest
  const resolved = resolveRef(ref, entries, builtInModules)
  if (resolved.kind === 'builtin') {
    const coreModule = resolved.builtIn
    return {
      json: {
        schemaVersion: 1,
        line,
        entry: null,
        candidates: resolved.candidates,
        anatomy: null,
        warnings: [builtInWarning(coreModule)],
        untrusted: null,
        card: cardUrl(searcher, coreModule.page),
      },
      builtIn: coreModule,
      builtInEnabled: builtInEnabled(coreModule.id, app.enabledModules),
      found: true,
    }
  }
  if (resolved.kind === 'none') {
    const id = stripVersion(ref).name.trim().toLowerCase()
    const shared = entries.filter((entry) => entry.moduleIds.includes(id))
    if (shared.length > 1) {
      return {
        json: {
          schemaVersion: 1,
          line,
          entry: null,
          candidates: resolved.candidates,
          anatomy: null,
          warnings: [sharedModuleIdWarning(id, shared.length)],
          untrusted: null,
          card: null,
        },
        builtIn: null,
        builtInEnabled: null,
        found: true,
      }
    }
    return {
      json: { schemaVersion: 1, error: unknownModuleMessage(ref, resolved.candidates), candidates: resolved.candidates },
      builtIn: null,
      builtInEnabled: null,
      found: false,
    }
  }
  const entry = resolved.entry
  return {
    json: {
      schemaVersion: 1,
      line,
      entry,
      candidates: [],
      anatomy: null,
      warnings: entryWarnings(entry, today, latest),
      untrusted: null,
      card: cardUrl(searcher, entry.links.md),
    },
    builtIn: null,
    builtInEnabled: null,
    found: true,
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function anatomyLine(entry: CatalogEntry): string | null {
  const lists = entry.anatomy?.lists
  if (!lists) return null
  const parts = [
    lists.tables && lists.tables.length > 0 ? plural(lists.tables.length, 'table', 'tables') : null,
    lists.aclFeatures && lists.aclFeatures.length > 0 ? plural(lists.aclFeatures.length, 'permission', 'permissions') : null,
    lists.eventsEmitted && lists.eventsEmitted.length > 0 ? `emits ${plural(lists.eventsEmitted.length, 'event', 'events')}` : null,
    lists.publicRoutes && lists.publicRoutes.length > 0
      ? plural(lists.publicRoutes.length, 'public route', 'public routes')
      : null,
  ].filter((item): item is string => item !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function renderInfoHuman(view: ModuleInfoView, searcher: CatalogSearcher): string[] {
  const { json } = view
  if ('error' in json) return [json.error]
  const out: string[] = []
  if (view.builtIn) {
    const coreModule = view.builtIn
    out.push(`${coreModule.id} is built into Open Mercato core: ${coreModule.title}.`)
    if (coreModule.description) out.push(`  ${coreModule.description}`)
    out.push(view.builtInEnabled ? '  Already enabled.' : `  enable: ${coreModule.install || builtInEnableCommand(coreModule.id)}`)
    if (json.candidates.length > 0) out.push(`  catalog modules with the same id: ${json.candidates.join(', ')}`)
    if (json.card) out.push(`  more: ${json.card}`)
    return out
  }
  const entry = json.entry
  if (!entry) {
    out.push(...json.warnings)
    if (json.candidates.length > 0) out.push(`Candidates: ${json.candidates.join(', ')}`)
    return out
  }
  const line = json.line
  out.push(entryHeading(entry, line))
  out.push(`  ${entry.title}: ${entry.summary}`)
  if (entry.whenToUse) out.push(`  ${entry.whenToUse}`)
  const lines = searcher.index.lines.map((item) => `${item.key} ${statusOn(entry, item.key)}`)
  if (lines.length > 0) out.push(`  lines: ${lines.join(' · ')}`)
  const policy = line ? (entry.agentPolicy[line] ?? null) : null
  if (policy && line) {
    out.push(`  agent policy on ${line}: ${policy.decision}`)
    for (const reason of policy.reasons.slice(0, 5)) out.push(`    ${reason.code}: ${reason.text}`)
  }
  const adds = anatomyLine(entry)
  if (adds) out.push(`  adds: ${adds}`)
  const lists = entry.anatomy?.lists
  const settings = [...(lists?.env ?? []), ...(lists?.credentials ?? []).map((credential) => credential.key)]
  if (settings.length > 0) out.push(`  needs settings: ${settings.slice(0, 10).join(', ')}`)
  if (lists?.hosts && lists.hosts.length > 0) out.push(`  talks to: ${lists.hosts.slice(0, 10).join(', ')}`)
  out.push(`  install: ${installCommand(entry, line, latestLine(searcher.index.lines)?.key ?? null)}`)
  for (const warning of json.warnings) out.push(`  warning: ${warning}`)
  out.push(`  install plan: ${json.card ?? entry.links.md}`)
  out.push(`  more: ${cardUrl(searcher, entry.links.page)}`)
  return out
}

export type ModuleSearchDeps = {
  appRoot?: string
  env?: NodeJS.ProcessEnv
  fetchImpl?: FetchLike
  now?: () => number
  stdout?: (line: string) => void
  stderr?: (line: string) => void
  readEnabledModules?: ReadEnabledModules | null
}

const SEARCH_USAGE =
  'Usage: yarn mercato module search <query> [--category <id>] [--kind <kind>] [--all-lines] [--limit <n>] [--json]'
const INFO_USAGE = 'Usage: yarn mercato module info <package-or-module-id> [--json]'

export const BUILT_IN_UNAVAILABLE_MESSAGE =
  'Built-in module list unavailable; results may miss modules already in Open Mercato core.'

type LoadedForCommand = { searcher: CatalogSearcher; app: AppContext; builtInUnavailable: boolean }

async function loadForCommand(deps: ModuleSearchDeps): Promise<LoadedForCommand> {
  const env = deps.env ?? process.env
  const appRoot = deps.appRoot ?? process.cwd()
  const stderr = deps.stderr ?? ((line: string) => console.error(line))
  const url = env.OM_MODULES_INDEX_URL?.trim() || DEFAULT_MODULES_INDEX_URL
  const builtInUrl = env.OM_MODULES_BUILTIN_URL?.trim() || undefined
  const loaded = await loadIndex({
    appRoot,
    url,
    ...(builtInUrl ? { builtInUrl } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  })
  if (loaded.source === 'stale-cache') stderr(`Using cached module index from ${loaded.fetchedAt}.`)
  if (loaded.builtInUnavailable !== null) {
    stderr(BUILT_IN_UNAVAILABLE_MESSAGE)
    stderr(`Reason: ${loaded.builtInUnavailable}`)
  }
  const app = detectAppContext(appRoot, deps.readEnabledModules ?? null)
  return {
    searcher: loaded.searcher,
    app,
    builtInUnavailable: loaded.builtInUnavailable !== null,
  }
}

function handleLoadError(error: unknown, stderr: (line: string) => void): number {
  if (error instanceof ModuleIndexUnavailableError) {
    stderr(MODULE_INDEX_UNAVAILABLE_MESSAGE)
    stderr(`Reason: ${error.detail}`)
    return MODULE_INDEX_UNAVAILABLE_EXIT_CODE
  }
  throw error
}

export async function runModuleSearch(args: string[], deps: ModuleSearchDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => console.log(line))
  const stderr = deps.stderr ?? ((line: string) => console.error(line))
  const parsed = parseModuleSearchArgs(args)
  if (!parsed.query) {
    stderr(SEARCH_USAGE)
    return 1
  }
  let loaded: LoadedForCommand
  try {
    loaded = await loadForCommand(deps)
  } catch (error: unknown) {
    return handleLoadError(error, stderr)
  }
  const view = buildSearchView(
    loaded.searcher,
    { query: parsed.query, category: parsed.category, kinds: parsed.kinds, allLines: parsed.allLines, limit: parsed.limit },
    loaded.app,
  )
  if (loaded.builtInUnavailable) view.json.builtInUnavailable = true
  const today = new Date(deps.now ? deps.now() : Date.now()).toISOString().slice(0, 10)
  if (parsed.json) stdout(JSON.stringify(view.json, null, 2))
  else for (const line of renderSearchHuman(view, today)) stdout(line)
  return 0
}

export async function runModuleInfo(args: string[], deps: ModuleSearchDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((line: string) => console.log(line))
  const stderr = deps.stderr ?? ((line: string) => console.error(line))
  const parsed = parseModuleInfoArgs(args)
  if (!parsed.ref) {
    stderr(INFO_USAGE)
    return 1
  }
  let loaded: LoadedForCommand
  try {
    loaded = await loadForCommand(deps)
  } catch (error: unknown) {
    return handleLoadError(error, stderr)
  }
  const today = new Date(deps.now ? deps.now() : Date.now()).toISOString().slice(0, 10)
  const view = buildInfoView(loaded.searcher, parsed.ref, loaded.app, today)
  if (parsed.json) stdout(JSON.stringify(view.json, null, 2))
  else if (view.found) for (const line of renderInfoHuman(view, loaded.searcher)) stdout(line)
  else for (const line of renderInfoHuman(view, loaded.searcher)) stderr(line)
  return view.found ? 0 : 1
}
