// Ranking and lookups behind `mercato module search|info`, kept identical to the Open Mercato Modules catalog
// (https://modules.openmercato.com, `lib/core/search.ts` and `lib/core/refs.ts`): same MiniSearch options, tokenizer,
// stop words, boosts and built-in rules, so the CLI, the catalog site and its MCP server rank the same way.
// `__tests__/module-search.test.ts` holds this file to the catalog's own output on a fixture built from real data.
import MiniSearch, { type Options, type SearchResult } from 'minisearch'

export type CellStatus = string
export type OriginType = 'official' | 'community' | '3rd-party'
export type EntryKind = 'module' | 'provider' | 'library' | 'tool'
export type LicenseKind = 'osi' | 'proprietary' | 'enterprise' | 'unknown'

export type AgentPolicy = {
  decision: 'allow' | 'ask' | 'refuse'
  reasons: { code: string; text: string }[]
  until?: string
  consentText?: string
}

export type CatalogLine = {
  key: string
  version: string
  source: 'latest' | 'previous' | 'develop'
}

export type AnatomyLists = {
  aclFeatures?: string[]
  eventsEmitted?: string[]
  eventsConsumed?: string[]
  env?: string[]
  hosts?: string[]
  tables?: string[]
  publicRoutes?: string[]
  credentials?: { key: string; type?: string; required?: boolean }[]
}

export type AnatomySummary = {
  version: string
  counts?: Record<string, number | null>
  lists?: AnatomyLists
  callout?: string | null
}

export type CatalogEntry = {
  locator: string
  path: string
  npm: string | null
  title: string
  summary: string
  whenToUse: string
  type: OriginType
  kind: EntryKind
  category: string
  tags: string[]
  providers: { name: string; label: string }[]
  moduleIds: string[]
  renamedFrom: string[]
  status: string
  listed: boolean
  featured: boolean
  license: { spdx: string | null; kind: LicenseKind; mismatch?: boolean }
  version: {
    latest: string | null
    preview: string | null
    installableFrom: string | null
    gitRef: string | null
    recommended: Record<string, string | null>
  }
  compat: {
    lines: Record<string, { status: CellStatus; at: string | null }>
    verifiedOn: string[]
  }
  anatomy: AnatomySummary | null
  signals?: {
    supplyChain?: { status: string; reasons: string[] }
    hygiene?: { status: string; failing: string[] }
    anatomy?: string
  }
  tier: 'listed' | 'verified' | null
  quality: unknown
  agentPolicy: Record<string, AgentPolicy>
  install: { cli: string; cmm?: string; needsAllowThirdParty?: boolean; moduleFlag: string | null }
  links: { page: string; md: string; json?: string; npm?: string | null; repo?: string | null }
  _meta?: Record<string, unknown>
}

export type CatalogIndex = {
  schemaVersion: 1
  generatedAt: string
  dataVersion: string
  site: string
  lines: CatalogLine[]
  entries: CatalogEntry[]
  builtIn?: { coreVersion: string; count: number; href: string }
}

export type BuiltInModule = {
  id: string
  title: string
  description: string
  category: string
  requires?: string[]
  inPresets?: string[]
  anatomy: AnatomySummary | null
  install: string
  page: string
}

export type BuiltInIndex = {
  schemaVersion: 1
  coreVersion: string
  generatedAt: string
  modules: BuiltInModule[]
}

export type ModuleCard = {
  locator: string
  path: string
  title: string
  summary: string
  whenToUse: string
  type: OriginType
  kind: EntryKind
  category: string
  license: { spdx: string | null; kind: LicenseKind }
  tier: 'listed' | 'verified' | null
  omQuality: boolean
  verifiedOn: string[]
  line: string | null
  status: CellStatus | null
  agentPolicy: AgentPolicy | null
  installableFrom: string | null
  install: string
  matchedOn: string[]
  card: string
}

export type BuiltInCard = {
  id: string
  title: string
  description: string
  category: string
  enabled: boolean | null
  install: string
  page: string
  matchedOn: string[]
}

export type SearchModulesInput = {
  query: string
  omVersion?: string
  category?: string
  type?: OriginType[]
  kind?: (EntryKind | 'built-in')[]
  verifiedOnly?: boolean
  includeBuiltIn?: boolean
  includeExamples?: boolean
  emits?: string
  consumes?: string
  provider?: string
  limit?: number
}

export type SearchModulesOutput = {
  results: ModuleCard[]
  builtIn: BuiltInCard[]
  total: number
  line: string | null
  dataVersion: string
  generatedAt: string
}

export const SEARCH_BOOST = {
  title: 3,
  npm: 3,
  summary: 2,
  whenToUse: 2,
  providers: 2,
  tags: 1.5,
  aliases: 1.5,
  renamedFrom: 1,
  category: 1,
  anatomy: 1,
} as const
type SearchField = keyof typeof SEARCH_BOOST
const SEARCH_FIELDS = Object.keys(SEARCH_BOOST) as SearchField[]

export const ALIASES_META_KEY = 'com.openmercato.modules/aliases'
export const INSTALLABLE_META_KEY = 'com.openmercato.modules/installable'
export const BUILTIN_MAX = 5
export const BUILTIN_RATIO = 0.5
export const BOOST_VERIFIED = 0.15
export const BOOST_OFFICIAL = 0.1
export const MIN_AND_RESULTS = 3
export const SEARCH_DEFAULTS = { verifiedOnly: false, includeBuiltIn: true, includeExamples: false, limit: 10 } as const
export const CORE_PACKAGE = '@open-mercato/core'

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'i', 'in', 'into', 'is', 'it', 'its', 'me',
  'module', 'modules', 'my', 'of', 'on', 'or', 'our', 'that', 'the', 'this', 'to', 'via', 'we', 'with', 'you', 'your',
])

export function tokenize(text: string): string[] {
  const lower = text.toLowerCase()
  const tokens = lower.split(/[^a-z0-9*]+/).filter((token) => token !== '')
  for (const match of lower.matchAll(/[a-z0-9]+(?:[._-][a-z0-9*]+)+/g)) tokens.push(match[0])
  return tokens
}

export function processTerm(term: string): string | null {
  return term.length < 2 || STOPWORDS.has(term) ? null : term
}

export type SearchDoc = {
  id: string
  group: 'module' | 'builtin'
  title: string
  npm: string
  summary: string
  whenToUse: string
  providers: string
  tags: string
  aliases: string
  renamedFrom: string
  category: string
  anatomy: string
}

const SEARCH_OPTIONS: Options<SearchDoc> = {
  idField: 'id',
  fields: SEARCH_FIELDS,
  storeFields: ['group'],
  tokenize,
  processTerm,
  searchOptions: { prefix: true, fuzzy: 0.2, boost: { ...SEARCH_BOOST } },
}

export type AnatomyIds = {
  event: string[]
  emits: string[]
  consumes: string[]
  entity: string[]
  permission: string[]
  env: string[]
  host: string[]
  setting: string[]
  module: string[]
}

export type ModuleMeta = {
  entry: CatalogEntry
  example: boolean
  omQuality: boolean
  ids: AnatomyIds
}

export type BuiltInMeta = {
  module: BuiltInModule
  ids: AnatomyIds
}

export type CatalogSearcher = {
  miniSearch: MiniSearch<SearchDoc>
  index: CatalogIndex
  builtIn: BuiltInIndex | null
  site: string
  modules: Map<string, ModuleMeta>
  builtInModules: Map<string, BuiltInMeta>
}

function anatomyIds(anatomy: AnatomySummary | null | undefined, moduleIds: readonly string[]): AnatomyIds {
  const lists = anatomy?.lists
  return {
    event: [...new Set([...(lists?.eventsEmitted ?? []), ...(lists?.eventsConsumed ?? [])])],
    emits: [...(lists?.eventsEmitted ?? [])],
    consumes: [...(lists?.eventsConsumed ?? [])],
    entity: lists?.tables ?? [],
    permission: lists?.aclFeatures ?? [],
    env: lists?.env ?? [],
    host: lists?.hosts ?? [],
    setting: (lists?.credentials ?? []).map((credential) => credential.key),
    module: [...moduleIds],
  }
}

const anatomyText = (ids: AnatomyIds) =>
  [...ids.module, ...ids.entity, ...ids.event, ...ids.permission, ...ids.setting, ...ids.env, ...ids.host].join(' ')

function aliasesOf(entry: CatalogEntry): string[] {
  const value = entry._meta?.[ALIASES_META_KEY]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function moduleDoc(entry: CatalogEntry, ids: AnatomyIds): SearchDoc {
  return {
    id: entry.locator,
    group: 'module',
    title: entry.title,
    npm: [entry.npm ?? entry.locator.replace(/^github:/, ''), entry.path].join(' '),
    summary: entry.summary,
    whenToUse: entry.whenToUse,
    providers: entry.providers.map((provider) => `${provider.name} ${provider.label}`).join(' '),
    tags: entry.tags.join(' '),
    aliases: aliasesOf(entry).join(' '),
    renamedFrom: entry.renamedFrom.map((locator) => locator.replace(/^(npm|github):/, '')).join(' '),
    category: entry.category,
    anatomy: anatomyText(ids),
  }
}

function builtInDoc(coreModule: BuiltInModule, ids: AnatomyIds): SearchDoc {
  return {
    id: `core:${coreModule.id}`,
    group: 'builtin',
    title: coreModule.title,
    npm: coreModule.id,
    summary: coreModule.description,
    whenToUse: '',
    providers: '',
    tags: '',
    aliases: '',
    renamedFrom: '',
    category: coreModule.category,
    anatomy: anatomyText(ids),
  }
}

export function createCatalogSearcher(index: CatalogIndex, builtIn: BuiltInIndex | null): CatalogSearcher {
  const miniSearch = new MiniSearch<SearchDoc>(SEARCH_OPTIONS)
  const modules = new Map<string, ModuleMeta>()
  const builtInModules = new Map<string, BuiltInMeta>()
  const docs: SearchDoc[] = []
  for (const entry of index.entries.filter((candidate) => candidate.listed)) {
    const ids = anatomyIds(entry.anatomy, entry.moduleIds)
    modules.set(entry.locator, {
      entry,
      ids,
      example: entry.tags.includes('example'),
      omQuality: entry.quality !== null && entry.quality !== undefined,
    })
    docs.push(moduleDoc(entry, ids))
  }
  for (const coreModule of builtIn?.modules ?? []) {
    const ids = anatomyIds(coreModule.anatomy, [coreModule.id])
    builtInModules.set(coreModule.id, { module: coreModule, ids })
    docs.push(builtInDoc(coreModule, ids))
  }
  miniSearch.addAll(docs)
  const loaded = MiniSearch.loadJS<SearchDoc>(miniSearch.toJSON(), SEARCH_OPTIONS)
  return { miniSearch: loaded, index, builtIn, site: index.site.replace(/\/+$/, ''), modules, builtInModules }
}

const absolute = (site: string, page: string) => (/^https?:\/\//.test(page) ? page : `${site}${page}`)

export function latestLine(lines: readonly CatalogLine[]): CatalogLine | null {
  return lines.find((line) => line.source === 'latest') ?? null
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function resolveLine(
  omVersion: string | null | undefined,
  lines: readonly CatalogLine[],
): { line: string | null; version: string | null; note: string | null } {
  const found = (line: CatalogLine | null) =>
    line ? { line: line.key, version: line.version, note: null } : { line: null, version: null, note: null }
  const raw = (omVersion ?? '').trim()
  if (raw === '') return found(latestLine(lines))
  const byKey = lines.find((line) => line.key === raw)
  if (byKey) return found(byKey)
  const version = raw.replace(/^(?:v|=|\^|~|>=)\s*/, '')
  const exact = lines.find((line) => line.version === version)
  if (exact) return found(exact)
  const semver = SEMVER.exec(version)
  if (semver && semver[4] && /(^|[.-])develop([.-]|$)/.test(semver[4])) {
    const next = lines.find((line) => line.source === 'develop')
    if (next) return found(next)
  }
  const majorMinor = /^(\d+)\.(\d+)(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?$/.exec(version)
  if (!majorMinor) return { line: null, version: null, note: 'Unknown Open Mercato version.' }
  const key = `${Number(majorMinor[1])}.${Number(majorMinor[2])}`
  const line = lines.find((candidate) => candidate.key === key)
  if (line) return found(line)
  return { line: null, version: null, note: `Line ${key} is not tested by the catalog.` }
}

function matchedOn(
  match: SearchResult['match'],
  meta: { providers?: readonly { name: string; label: string }[]; tags?: readonly string[]; ids: AnatomyIds; category?: string },
  queryTerms: readonly string[] = [],
): string[] {
  const chips: string[] = []
  const add = (chip: string) => {
    if (!chips.includes(chip)) chips.push(chip)
  }
  const has = (id: string, term: string) => tokenize(id).includes(term)
  const order: SearchField[] = ['title', 'npm', 'aliases', 'renamedFrom', 'providers', 'anatomy', 'summary', 'whenToUse', 'tags', 'category']
  const typed = new Set(queryTerms)
  const fieldsByTerm = Object.entries(match).sort(
    (left, right) => Number(typed.has(right[0])) - Number(typed.has(left[0])) || right[0].length - left[0].length,
  )
  for (const field of order) {
    for (const [term, fields] of fieldsByTerm) {
      if (!fields.includes(field)) continue
      if (field === 'title' || field === 'npm' || field === 'aliases' || field === 'renamedFrom') add('name')
      else if (field === 'summary' || field === 'whenToUse') add('summary')
      else if (field === 'tags') {
        const tag = meta.tags?.find((candidate) => has(candidate, term))
        add(tag ? `tag ${tag}` : 'summary')
      } else if (field === 'category' && meta.category) add(`category ${meta.category}`)
      else if (field === 'providers') {
        const provider = meta.providers?.find((candidate) => has(candidate.name, term) || has(candidate.label, term))
        add(provider ? `provider ${provider.label}` : 'provider')
      } else if (field === 'anatomy') anatomyChips(meta.ids, fieldsByTerm, has).forEach(add)
    }
  }
  return chips.slice(0, 5)
}

function anatomyChips(
  ids: AnatomyIds,
  fieldsByTerm: readonly (readonly [string, readonly string[]])[],
  has: (id: string, term: string) => boolean,
): string[] {
  const kinds: (keyof AnatomyIds)[] = ['event', 'entity', 'permission', 'env', 'setting', 'host', 'module']
  const terms = fieldsByTerm.filter(([, fields]) => fields.includes('anatomy')).map(([term]) => term)
  const left = new Set(terms)
  const chips: string[] = []
  while (left.size > 0) {
    let best: { chip: string; covers: string[]; exact: boolean; first: number } | null = null
    for (const kind of kinds)
      for (const id of ids[kind]) {
        const covers = terms.filter((term) => left.has(term) && (id === term || has(id, term)))
        if (covers.length === 0) continue
        const exact = covers.includes(id)
        const first = terms.indexOf(covers[0] as string)
        const better =
          !best ||
          covers.length > best.covers.length ||
          (covers.length === best.covers.length && (exact && !best.exact ? true : exact === best.exact && first < best.first))
        if (better) best = { chip: `${kind} ${id}`, covers, exact, first }
      }
    if (!best) break
    chips.push(best.chip)
    for (const term of best.covers) left.delete(term)
  }
  return chips
}

export function statusOn(entry: CatalogEntry, line: string): CellStatus {
  if (entry.version.recommended[line]) return 'verified'
  return entry.compat.lines[line]?.status ?? 'untested'
}

function installableOn(entry: CatalogEntry, line: string | null): string | null | undefined {
  if (line === null) return undefined
  const map = entry._meta?.[INSTALLABLE_META_KEY]
  if (!map || typeof map !== 'object') return undefined
  const value = (map as Record<string, unknown>)[line]
  return typeof value === 'string' ? value : value === null ? null : undefined
}

export function installVersion(entry: CatalogEntry, line: string | null): string | null {
  return (
    (line !== null ? entry.version.recommended[line] : null) ??
    installableOn(entry, line) ??
    entry.version.latest ??
    entry.version.preview ??
    null
  )
}

export function builtInEnableCommand(id: string): string {
  return `yarn mercato module enable ${CORE_PACKAGE} --module ${id}`
}

export function installCommand(entry: CatalogEntry, line: string | null, latest: string | null): string {
  if (line === null || line === latest) return entry.install.cli
  const version = installVersion(entry, line)
  if (entry.npm === null) {
    const repo = entry.locator.replace(/^github:/, '')
    const ref = entry.version.gitRef ? ` --ref ${entry.version.gitRef}` : ''
    return `npx create-mercato-module install ${repo}${ref}`
  }
  const spec = version ? `${entry.npm}@${version}` : entry.npm
  const thirdParty = !entry.npm.startsWith('@open-mercato/')
  const moduleFlag = entry.install.moduleFlag
  return `yarn mercato module add ${spec}${thirdParty ? ' --allow-third-party' : ''}${moduleFlag ? ` --module ${moduleFlag}` : ''}`
}

export type RankedSearch = {
  line: string | null
  latest: string | null
  modules: { meta: ModuleMeta; result: SearchResult }[]
  builtIn: BuiltInCard[]
}

export function rankModules(searcher: CatalogSearcher, rawInput: SearchModulesInput): RankedSearch {
  const input = {
    ...rawInput,
    verifiedOnly: rawInput.verifiedOnly ?? SEARCH_DEFAULTS.verifiedOnly,
    includeBuiltIn: rawInput.includeBuiltIn ?? SEARCH_DEFAULTS.includeBuiltIn,
    includeExamples: rawInput.includeExamples ?? SEARCH_DEFAULTS.includeExamples,
  }
  const lines = searcher.index.lines
  const latest = latestLine(lines)?.key ?? null
  const line = input.omVersion ? resolveLine(input.omVersion, lines).line : latest
  const boostDocument = (id: unknown) => {
    const meta = searcher.modules.get(String(id))
    if (!meta) return 1
    const verified = line !== null && statusOn(meta.entry, line) === 'verified' ? 1 : 0
    return 1 + BOOST_VERIFIED * verified + BOOST_OFFICIAL * (meta.entry.type === 'official' ? 1 : 0)
  }
  const wantKinds = input.kind
  const provider = input.provider?.toLowerCase()
  const moduleOk = (meta: ModuleMeta) => {
    const entry = meta.entry
    return (
      entry.listed &&
      (input.includeExamples || !meta.example) &&
      (!input.category || entry.category === input.category) &&
      (!input.type || input.type.includes(entry.type)) &&
      (!wantKinds || wantKinds.includes(entry.kind)) &&
      (!input.verifiedOnly || (line !== null && statusOn(entry, line) === 'verified')) &&
      (!input.emits || meta.ids.emits.includes(input.emits)) &&
      (!input.consumes || meta.ids.consumes.includes(input.consumes)) &&
      (!provider || entry.providers.some((item) => item.name === provider || item.label.toLowerCase() === provider))
    )
  }
  const builtInOk = (meta: BuiltInMeta) =>
    input.includeBuiltIn &&
    (!wantKinds || wantKinds.includes('built-in')) &&
    (!input.type || input.type.includes('official')) &&
    (!input.category || meta.module.category === input.category) &&
    !input.provider &&
    !input.verifiedOnly &&
    (!input.emits || meta.ids.emits.includes(input.emits)) &&
    (!input.consumes || meta.ids.consumes.includes(input.consumes))

  const run = (combineWith: 'AND' | 'OR') => {
    const hits = searcher.miniSearch.search(input.query, {
      combineWith,
      prefix: true,
      fuzzy: 0.2,
      boost: { ...SEARCH_BOOST },
      boostDocument,
    })
    const modules: { meta: ModuleMeta; result: SearchResult }[] = []
    const builtIns: { meta: BuiltInMeta; result: SearchResult }[] = []
    for (const result of hits) {
      const id = String(result.id)
      if (result['group'] === 'builtin') {
        const meta = searcher.builtInModules.get(id.replace(/^core:/, ''))
        if (meta && builtInOk(meta)) builtIns.push({ meta, result })
      } else {
        const meta = searcher.modules.get(id)
        if (meta && moduleOk(meta)) modules.push({ meta, result })
      }
    }
    return { modules, builtIns }
  }
  let found = run('AND')
  if (found.modules.length === 0 && found.builtIns.length === 0) found = run('OR')
  else if (found.modules.length < MIN_AND_RESULTS && tokenize(input.query).filter((term) => processTerm(term)).length > 1) {
    const orHits = run('OR')
    const seen = new Set(found.modules.map((hit) => hit.meta.entry.locator))
    found = { modules: [...found.modules, ...orHits.modules.filter((hit) => !seen.has(hit.meta.entry.locator))], builtIns: found.builtIns }
  }

  const best = found.modules[0]?.result.score ?? 0
  const query = input.query.trim().toLowerCase()
  const builtIn: BuiltInCard[] = found.builtIns
    .filter(
      ({ meta, result }) =>
        result.score >= BUILTIN_RATIO * best ||
        meta.module.title.toLowerCase() === query ||
        meta.module.id === query.replace(/[\s-]+/g, '_'),
    )
    .slice(0, BUILTIN_MAX)
    .map(({ meta, result }) => ({
      id: meta.module.id,
      title: meta.module.title,
      description: meta.module.description,
      category: meta.module.category,
      enabled: null,
      install: meta.module.install || builtInEnableCommand(meta.module.id),
      page: absolute(searcher.site, meta.module.page),
      matchedOn: matchedOn(result.match, { ids: meta.ids }, result.queryTerms),
    }))
  return { line, latest, modules: found.modules, builtIn }
}

export function toModuleCard(
  searcher: CatalogSearcher,
  hit: { meta: ModuleMeta; result: SearchResult },
  line: string | null,
  latest: string | null,
): ModuleCard {
  const entry = hit.meta.entry
  return {
    locator: entry.locator,
    path: entry.path,
    title: entry.title,
    summary: entry.summary,
    whenToUse: entry.whenToUse,
    type: entry.type,
    kind: entry.kind,
    category: entry.category,
    license: { spdx: entry.license.spdx, kind: entry.license.kind },
    tier: entry.tier,
    omQuality: hit.meta.omQuality,
    verifiedOn: entry.compat.verifiedOn,
    line,
    status: line ? statusOn(entry, line) : null,
    agentPolicy: line ? (entry.agentPolicy[line] ?? null) : null,
    installableFrom: entry.version.installableFrom,
    install: installCommand(entry, line, latest),
    matchedOn: matchedOn(
      hit.result.match,
      { providers: entry.providers, tags: entry.tags, ids: hit.meta.ids, category: entry.category },
      hit.result.queryTerms,
    ),
    card: absolute(searcher.site, entry.links.page),
  }
}

export function searchModules(searcher: CatalogSearcher, input: SearchModulesInput): SearchModulesOutput {
  const limit = Math.min(20, Math.max(1, Math.floor(input.limit ?? SEARCH_DEFAULTS.limit)))
  const ranked = rankModules(searcher, input)
  return {
    results: ranked.modules.slice(0, limit).map((hit) => toModuleCard(searcher, hit, ranked.line, ranked.latest)),
    builtIn: ranked.builtIn,
    total: ranked.modules.length,
    line: ranked.line,
    dataVersion: searcher.index.dataVersion,
    generatedAt: searcher.index.generatedAt,
  }
}

export function stripVersion(ref: string): { name: string; version: string | null } {
  const match = /^(.+?)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(ref.trim())
  return match ? { name: match[1] as string, version: match[2] as string } : { name: ref.trim(), version: null }
}

export type ResolvedRef =
  | { kind: 'entry'; entry: CatalogEntry; candidates: string[] }
  | { kind: 'builtin'; builtIn: BuiltInModule; candidates: string[] }
  | { kind: 'none'; candidates: string[] }

const normalizeRef = (value: string) => value.trim().toLowerCase()
const rankEntry = (entry: CatalogEntry) => (entry.type === 'official' ? 0 : 2) + (entry.tier === 'verified' ? 0 : 1)

export function resolveRef(ref: string, entries: readonly CatalogEntry[], builtIn: readonly BuiltInModule[]): ResolvedRef {
  const wanted = normalizeRef(stripVersion(ref).name)
  const direct = entries.find(
    (entry) =>
      normalizeRef(entry.locator) === wanted ||
      (entry.npm !== null && normalizeRef(entry.npm) === wanted) ||
      normalizeRef(entry.path) === wanted ||
      normalizeRef(`/m/${entry.path}`) === wanted ||
      entry.renamedFrom.some((previous) => normalizeRef(previous) === wanted || normalizeRef(previous) === `npm:${wanted}`),
  )
  if (direct) return { kind: 'entry', entry: direct, candidates: [] }
  const githubPath = wanted.startsWith('github:')
    ? `github/${wanted.slice(7)}`
    : wanted.replace(/^https:\/\/github\.com\//, 'github/')
  const github = entries.find((entry) => normalizeRef(entry.path) === githubPath)
  if (github) return { kind: 'entry', entry: github, candidates: [] }

  const id = wanted.replace(/^core:/, '')
  const byId = entries.filter((entry) => entry.moduleIds.includes(id)).sort((left, right) => rankEntry(left) - rankEntry(right))
  const core = builtIn.find((coreModule) => coreModule.id === id)
  if (core) return { kind: 'builtin', builtIn: core, candidates: byId.map((entry) => entry.locator).slice(0, 10) }
  if (byId.length === 1) return { kind: 'entry', entry: byId[0] as CatalogEntry, candidates: [] }
  if (byId.length > 1) return { kind: 'none', candidates: byId.map((entry) => entry.locator).slice(0, 10) }

  const loose = entries
    .filter(
      (entry) =>
        wanted.length >= 3 &&
        (normalizeRef(entry.locator).includes(wanted) || entry.moduleIds.some((moduleId) => moduleId.includes(wanted.replace(/-/g, '_')))),
    )
    .sort((left, right) => rankEntry(left) - rankEntry(right))
  return { kind: 'none', candidates: loose.map((entry) => entry.locator).slice(0, 10) }
}

const clip = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max - 3)}...` : text)

export function entryWarnings(entry: CatalogEntry, today: string, line: string | null): string[] {
  const warnings: string[] = []
  if (!entry.listed) warnings.push(`Not listed: ${(line ? entry.agentPolicy[line] : null)?.reasons[0]?.text ?? 'see the card.'}`)
  if (entry.status !== 'active') warnings.push(`Status: ${entry.status}.`)
  if (entry.version.installableFrom && entry.version.installableFrom > today)
    warnings.push(
      `${entry.version.latest ?? 'The newest release'} is installable from ${entry.version.installableFrom} (Yarn age gate).`,
    )
  if (entry.license.mismatch) warnings.push('License sources disagree. See the card.')
  const supplyChain = entry.signals?.supplyChain
  if (supplyChain && supplyChain.status !== 'ok')
    warnings.push(`Supply chain ${supplyChain.status}: ${supplyChain.reasons.join('; ') || 'see the card'}.`)
  const hygiene = entry.signals?.hygiene
  if (hygiene && hygiene.status !== 'ok') warnings.push(`Hygiene ${hygiene.status}: ${hygiene.failing.join(', ') || 'see the card'}.`)
  if (entry.signals?.anatomy === 'hidden') warnings.push('Anatomy is not published for this entry.')
  return warnings.map((warning) => clip(warning)).slice(0, 10)
}

export function unknownModuleMessage(ref: string, candidates: readonly string[]): string {
  return candidates.length > 0
    ? `Unknown module "${ref.slice(0, 80)}". Did you mean: ${candidates.join(', ')}?`
    : `Unknown module "${ref.slice(0, 80)}".`
}

export function builtInWarning(coreModule: BuiltInModule): string {
  return clip(`Built into Open Mercato core as ${coreModule.id}. Enable it: ${coreModule.install}`)
}

export function sharedModuleIdWarning(id: string, count: number): string {
  return clip(`Module ID ${id} is provided by ${count} entries. Pick one of the candidates.`)
}

export function cardUrl(searcher: CatalogSearcher, page: string): string {
  return absolute(searcher.site, page)
}
