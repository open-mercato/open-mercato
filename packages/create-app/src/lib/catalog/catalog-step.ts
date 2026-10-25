import {
  catalogLineFor,
  fetchPickerCatalog,
  modulesWithoutLineInstall,
  resolvePickerUrl,
  selectableModules,
  type CatalogFetch,
} from './fetch-catalog.js'
import {
  buildSelectionFile,
  CATALOG_SELECTION_FILE,
  describeModule,
  findCatalogModules,
  installCommands,
  resolveCatalogSelection,
  writeSelectionFile,
  type CatalogSelection,
} from './selection.js'
import type { CatalogModule } from './types.js'

export const MODULES_SITE_URL = 'https://modules.openmercato.com'

export type CatalogAsk = (question: string) => Promise<string>

export type CatalogStepOptions = {
  targetDir: string
  version: string
  requested: string[] | null
  picker: boolean
  presetModuleIds: string[] | null
  /** Modules of a preset other than classic, with their packages; absent or null for classic. */
  presetModules?: { id: string; from: string }[] | null
  ask: CatalogAsk | null
  log: (line: string) => void
  warn: (line: string) => void
  env?: NodeJS.ProcessEnv
  fetchImpl?: CatalogFetch
}

export type CatalogStepResult = {
  commands: string[]
  selectionFile: string | null
}

const EMPTY_RESULT: CatalogStepResult = { commands: [], selectionFile: null }

export function parsePickerAnswer(answer: string, count: number): number[] {
  const trimmed = answer.trim()
  if (trimmed === '') return []
  const numbers = trimmed
    .split(/[\s,]+/)
    .filter((item) => item !== '')
    .map((item) => {
      if (!/^\d+$/.test(item)) throw new Error(`"${item}" is not a number from the list.`)
      const value = Number(item)
      if (value < 1 || value > count) throw new Error(`${value} is not on the list (1-${count}).`)
      return value
    })
  return [...new Set(numbers)]
}

export async function promptCatalogModules(
  ask: CatalogAsk,
  selectable: readonly CatalogModule[],
  line: string,
  log: (line: string) => void,
  warn: (line: string) => void,
  alreadyInAppCount = 0,
): Promise<CatalogModule[]> {
  log('')
  log(`🧩  Modules from the Open Mercato Modules catalog (verified on ${line})`)
  log('')
  const idWidth = Math.max(...selectable.map((entry) => entry.id.length))
  // Two packages may publish the same module id; their npm names tell the rows apart.
  const shared = (entry: CatalogModule) => selectable.filter((other) => other.id === entry.id).length > 1
  selectable.forEach((entry, index) => {
    const number = String(index + 1).padStart(String(selectable.length).length)
    const from = shared(entry) ? `${entry.from} · ` : ''
    log(`   ${number}. ${entry.id.padEnd(idWidth)}  ${entry.title}  (${from}${describeModule(entry, line)})`)
  })
  if (alreadyInAppCount > 0) {
    log(`   Not listed: ${alreadyInAppCount} catalog module${alreadyInAppCount === 1 ? '' : 's'} the app already registers in src/modules.ts.`)
  }
  log('')
  log('   Third-party modules run with access to all tenants\' data. Check the license before you pick.')
  log('')
  while (true) {
    const answer = await ask('   Numbers to add, comma-separated [none]: ')
    try {
      return parsePickerAnswer(answer, selectable.length).map((number) => selectable[number - 1] as CatalogModule)
    } catch (error: unknown) {
      warn(`   ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/**
 * True when the new app already registers this catalog module on the line, so there is nothing to install: for the
 * classic preset the catalog says so (`inPresets`), for another preset its own module list does.
 */
export function alreadyInApp(entry: CatalogModule, line: string, options: Pick<CatalogStepOptions, 'presetModuleIds' | 'presetModules'>): boolean {
  if (entry.source === 'core') return false
  if (options.presetModuleIds === null) return entry.inPresets.includes(line)
  return (options.presetModules ?? []).some((module) => module.id === entry.id && module.from === entry.from)
}

function alreadyInAppText(entry: CatalogModule, line: string, lines: readonly string[], classic: boolean): string {
  if (classic && entry.presetNote && line === lines[0]) return entry.presetNote
  const app = classic ? 'a new app' : 'the preset'
  return `Nothing to install: ${app} already registers ${entry.id} in src/modules.ts.`
}

const comparable = (value: string) => value.trim().toLowerCase().replace(/^npm:/, '').replace(/-/g, '_')

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min((previous[j] as number) + 1, (current[j - 1] as number) + 1, (previous[j - 1] as number) + cost)
    }
    previous = current
  }
  return previous[right.length] as number
}

/** The catalog module ID or npm name closest to a name the catalog does not have, or null when none is close. */
export function closestCatalogName(request: string, modules: readonly CatalogModule[]): string | null {
  const wanted = comparable(request)
  if (wanted === '') return null
  let best: { name: string; score: number } | null = null
  for (const entry of modules) {
    for (const name of [entry.id, entry.from]) {
      const candidate = comparable(name)
      const distance = editDistance(wanted, candidate)
      const contains = wanted.length >= 4 && (candidate.includes(wanted) || wanted.includes(candidate))
      const close = distance <= Math.max(1, Math.floor(wanted.length / 4))
      if (!contains && !close) continue
      const score = close ? distance : distance + 100
      if (!best || score < best.score) best = { name, score }
    }
  }
  return best?.name ?? null
}

function requirementHint(requires: string): string {
  if (/^[a-z][a-z0-9_]*$/.test(requires)) return `yarn mercato module enable @open-mercato/core --module ${requires}`
  return `install ${requires} first`
}

type CatalogContext = {
  line: string
  lines: readonly string[]
  all: readonly CatalogModule[]
  inApp: readonly CatalogModule[]
  withoutLineInstall: readonly CatalogModule[]
}

function reportSelection(selection: CatalogSelection, context: CatalogContext, options: CatalogStepOptions): void {
  const { line } = context
  const coreModules = context.all.filter((entry) => entry.source === 'core')
  const packages = context.all.filter((entry) => entry.source !== 'core')
  for (const request of selection.unknown) {
    const core = coreModules.find((entry) => entry.id === request.trim().toLowerCase())
    const inApp = findCatalogModules(request, context.inApp)
    if (inApp.length > 0) {
      for (const entry of inApp) options.log(alreadyInAppText(entry, line, context.lines, options.presetModuleIds === null))
    } else if (findCatalogModules(request, context.withoutLineInstall).length > 0) {
      options.warn(`${request} is verified on ${line}, but the module catalog gives no install command for ${line} yet. Add it later from ${MODULES_SITE_URL}.`)
    } else if (core && (options.presetModuleIds === null || options.presetModuleIds.includes(core.id))) {
      options.log(`${core.id} is built into Open Mercato core and the preset already enables it.`)
    } else if (core) {
      options.warn(`${core.id} is built into Open Mercato core, not a package: ${core.install}`)
    } else if (findCatalogModules(request, packages).length > 0) {
      options.warn(`Not verified on ${line}: ${request} is in the module catalog, but the catalog has not verified it on ${line}. Check its page on ${MODULES_SITE_URL} or pick an alternative there.`)
    } else {
      const suggestion = closestCatalogName(request, context.all)
      options.warn(
        suggestion
          ? `Not in the module catalog: ${request}. Did you mean ${suggestion}?`
          : `Not in the module catalog: ${request}. Search ${MODULES_SITE_URL} for modules.`,
      )
    }
  }
  for (const item of selection.ambiguous) {
    const picks = item.picks.join(', ')
    if (item.requiredBy) {
      options.warn(
        `${item.requiredBy} requires ${item.request}, which several catalog modules provide (${item.candidates.join(', ')}), so none is planned. Add the one you want to --modules as one of: ${picks}.`,
      )
    } else {
      options.warn(`"${item.request}" matches several modules (${item.candidates.join(', ')}), so none is planned. Pass one of these to --modules instead: ${picks}.`)
    }
  }
  for (const item of selection.unmetRequires) {
    options.warn(`${item.id} requires ${item.requires}, which the preset does not enable: ${requirementHint(item.requires)}`)
  }
  if (selection.selected.length === 0) return
  options.log('')
  options.log('Modules planned from the catalog:')
  for (const { entry, reason } of selection.selected) {
    const required = reason === 'required' ? ', required by another pick' : ''
    options.log(`  ${entry.id} from ${entry.from} (${describeModule(entry, line)}${required})`)
  }
  if (selection.selected.some(({ entry }) => entry.source === 'third-party' || entry.source === 'community')) {
    options.log('  Community and third-party code runs with access to all tenants\' data; their commands carry --allow-third-party.')
  }
}

export async function runCatalogStep(options: CatalogStepOptions): Promise<CatalogStepResult> {
  const url = resolvePickerUrl(options.env)
  const fetched = await fetchPickerCatalog({ url, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) })
  if (fetched.status === 'unavailable') {
    options.warn(
      `Module catalog unavailable (${fetched.reason}). The app keeps its preset modules; add more later from ${MODULES_SITE_URL}.`,
    )
    return EMPTY_RESULT
  }
  const line = catalogLineFor(options.version, fetched.index.lines)
  if (line === null) {
    options.warn(
      `The module catalog does not verify modules for Open Mercato ${options.version} yet. The app keeps its preset modules.`,
    )
    return EMPTY_RESULT
  }
  const inApp = fetched.index.modules.filter((entry) => alreadyInApp(entry, line, options))
  const notInApp = (entry: CatalogModule) => !inApp.some((other) => other.id === entry.id && other.from === entry.from)
  const selectable = selectableModules(fetched.index, line).filter(notInApp)
  const withoutLineInstall = modulesWithoutLineInstall(fetched.index, line).filter(notInApp)
  const requests = [...(options.requested ?? [])]
  let picked: CatalogModule[] = []
  if (options.picker) {
    if (!options.ask) {
      options.warn('--module-picker needs an interactive terminal; skipped. Use --modules <list> instead.')
    } else {
      if (withoutLineInstall.length > 0) {
        options.warn(
          `Left out of the list: ${withoutLineInstall.map((entry) => entry.id).join(', ')}. The module catalog verifies them on ${line} but gives no install command for ${line} yet.`,
        )
      }
      if (selectable.length === 0) {
        if (withoutLineInstall.length === 0 && inApp.length > 0) {
          options.log(`Nothing to add from the module catalog: the app already registers the modules verified on ${line}.`)
        } else if (withoutLineInstall.length === 0) options.warn(`No catalog modules are verified on ${line} yet.`)
      } else {
        picked = await promptCatalogModules(options.ask, selectable, line, options.log, options.warn, inApp.length)
      }
    }
  }
  if (requests.length === 0 && picked.length === 0) return EMPTY_RESULT
  const selection = resolveCatalogSelection(requests, selectable, options.presetModuleIds, picked)
  reportSelection(selection, { line, lines: fetched.index.lines, all: fetched.index.modules, inApp, withoutLineInstall }, options)
  if (selection.selected.length === 0) return EMPTY_RESULT
  const selectionFile = writeSelectionFile(options.targetDir, buildSelectionFile(url, fetched.index, line, selection))
  options.log(`  Saved to ${CATALOG_SELECTION_FILE}. Nothing is installed until you run the commands below.`)
  options.log('')
  return { commands: installCommands(selection), selectionFile }
}
