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
): Promise<CatalogModule[]> {
  log('')
  log(`🧩  Modules from the Open Mercato Modules catalog (verified on ${line})`)
  log('')
  const idWidth = Math.max(...selectable.map((entry) => entry.id.length))
  selectable.forEach((entry, index) => {
    const number = String(index + 1).padStart(String(selectable.length).length)
    log(`   ${number}. ${entry.id.padEnd(idWidth)}  ${entry.title}  (${describeModule(entry, line)})`)
  })
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

function requirementHint(requires: string): string {
  if (/^[a-z][a-z0-9_]*$/.test(requires)) return `yarn mercato module enable @open-mercato/core --module ${requires}`
  return `install ${requires} first`
}

function reportSelection(
  selection: CatalogSelection,
  line: string,
  coreModules: readonly CatalogModule[],
  withoutLineInstall: readonly CatalogModule[],
  options: CatalogStepOptions,
): void {
  for (const request of selection.unknown) {
    const core = coreModules.find((entry) => entry.id === request.trim().toLowerCase())
    if (findCatalogModules(request, withoutLineInstall).length > 0) {
      options.warn(`${request} is verified on ${line}, but the module catalog gives no install command for ${line} yet. Add it later from ${MODULES_SITE_URL}.`)
    } else if (core && (options.presetModuleIds === null || options.presetModuleIds.includes(core.id))) {
      options.log(`${core.id} is built into Open Mercato core and the preset already enables it.`)
    } else if (core) {
      options.warn(`${core.id} is built into Open Mercato core, not a package: ${core.install}`)
    } else {
      options.warn(`Not verified on ${line} in the module catalog: ${request}. Search ${MODULES_SITE_URL} for alternatives.`)
    }
  }
  for (const item of selection.ambiguous) {
    options.warn(`"${item.request}" matches several modules (${item.candidates.join(', ')}). Pass a module id instead.`)
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
  const selectable = selectableModules(fetched.index, line)
  const withoutLineInstall = modulesWithoutLineInstall(fetched.index, line)
  const requests = [...(options.requested ?? [])]
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
        if (withoutLineInstall.length === 0) options.warn(`No catalog modules are verified on ${line} yet.`)
      } else {
        const picked = await promptCatalogModules(options.ask, selectable, line, options.log, options.warn)
        for (const entry of picked) if (!requests.includes(entry.id)) requests.push(entry.id)
      }
    }
  }
  if (requests.length === 0) return EMPTY_RESULT
  const selection = resolveCatalogSelection(requests, selectable, options.presetModuleIds)
  const coreModules = fetched.index.modules.filter((entry) => entry.source === 'core')
  reportSelection(selection, line, coreModules, withoutLineInstall, options)
  if (selection.selected.length === 0) return EMPTY_RESULT
  const selectionFile = writeSelectionFile(options.targetDir, buildSelectionFile(url, fetched.index, line, selection))
  options.log(`  Saved to ${CATALOG_SELECTION_FILE}. Nothing is installed until you run the commands below.`)
  options.log('')
  return { commands: installCommands(selection), selectionFile }
}
