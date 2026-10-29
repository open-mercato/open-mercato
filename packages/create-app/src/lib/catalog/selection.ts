import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogModule, CatalogSelectionFile, PickerIndex } from './types.js'

export const CATALOG_SELECTION_FILE = join('.mercato', 'catalog-selection.json')

export type SelectedModule = { entry: CatalogModule; reason: 'requested' | 'required' }

export type CatalogSelection = {
  selected: SelectedModule[]
  unknown: string[]
  /**
   * Requests and requirements several catalog modules match, none of them planned. `candidates` names each match
   * (`<id> from <npm name>` when packages share the module id), and `picks` holds, in the same order, a `--modules`
   * item that matches that module alone, so following the advice always ends. `requiredBy` names the module whose
   * `requires` entry is ambiguous.
   */
  ambiguous: { request: string; candidates: string[]; picks: string[]; requiredBy?: string }[]
  unmetRequires: { id: string; requires: string }[]
}

export type PresetModule = { id: string; from: string }

export type SelectionContext = {
  /** Module IDs the catalog lists as built into Open Mercato core (`source: 'core'`). */
  coreModuleIds?: readonly string[]
  /** Modules a preset other than classic registers, with their packages; absent or null for classic. */
  presetModules?: readonly PresetModule[] | null
}

export function parseModulesFlag(value: string): string[] {
  const items = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  return [...new Set(items)]
}

const sameName = (left: string, right: string) => left.trim().toLowerCase() === right.trim().toLowerCase()

const moduleKey = (entry: CatalogModule) => `${entry.from}#${entry.id}`

const CORE_PREFIX = /^core:/i

/** The core module ID a `requires` entry names (`<id>` of a core module, or `core:<id>`), or null. */
function coreRequirement(requirement: string, coreModuleIds: readonly string[]): string | null {
  if (CORE_PREFIX.test(requirement)) return requirement.replace(CORE_PREFIX, '').trim()
  return coreModuleIds.some((id) => sameName(id, requirement)) ? requirement.trim() : null
}

/**
 * Modules matching a `--modules` item by ID, npm name, locator (`npm:<name>`) or `<npm name>:<module id>`, the form
 * that picks one module of a package with several when another package publishes the same module id.
 */
export function findCatalogModules(request: string, modules: readonly CatalogModule[]): CatalogModule[] {
  const name = request.replace(/^npm:/i, '')
  const qualified = /^(.+):([a-z][a-z0-9_]*)$/i.exec(name.trim())
  if (qualified && modules.some((entry) => sameName(entry.from, qualified[1] as string))) {
    return modules.filter((entry) => sameName(entry.from, qualified[1] as string) && sameName(entry.id, qualified[2] as string))
  }
  const byId = modules.filter((entry) => sameName(entry.id, name))
  if (byId.length > 0) return byId
  return modules.filter((entry) => sameName(entry.from, name) || sameName(entry.locator, request))
}

/**
 * Plans the modules named by `requests` (`--modules` items) and `picked` (entries chosen in the picker, which keep
 * their package), each after the catalog modules it requires. Two packages may publish the same module id, so a
 * name that matches modules of different packages is reported as ambiguous, never resolved to the first one.
 */
export function resolveCatalogSelection(
  requests: readonly string[],
  selectable: readonly CatalogModule[],
  presetModuleIds: readonly string[] | null,
  picked: readonly CatalogModule[] = [],
  context: SelectionContext = {},
): CatalogSelection {
  const selected: SelectedModule[] = []
  const unknown: string[] = []
  const ambiguous: CatalogSelection['ambiguous'] = []
  const unmetRequires: CatalogSelection['unmetRequires'] = []
  const targets: CatalogModule[] = []
  const addTarget = (entry: CatalogModule) => {
    if (!targets.some((target) => moduleKey(target) === moduleKey(entry))) targets.push(entry)
  }
  const matchesOnly = (pick: string, entry: CatalogModule) => {
    const found = findCatalogModules(pick, selectable)
    return found.length > 0 && found.every((other) => moduleKey(other) === moduleKey(entry))
  }
  // The shortest item that names this module alone: its id, its npm name, or `<npm name>:<id>`, which always does.
  const pickFor = (entry: CatalogModule) =>
    [entry.id, entry.from].find((pick) => matchesOnly(pick, entry)) ?? `${entry.from}:${entry.id}`
  const candidatesOf = (matches: readonly CatalogModule[]) => {
    const packages = new Set(matches.map((match) => match.from))
    return {
      candidates: matches.map((match) => (packages.size > 1 ? `${match.id} from ${match.from}` : match.id)),
      picks: matches.map(pickFor),
    }
  }

  for (const request of requests) {
    const matches = findCatalogModules(request, selectable).filter(
      (match, position, all) => all.findIndex((other) => moduleKey(other) === moduleKey(match)) === position,
    )
    if (matches.length === 0) unknown.push(request)
    else if (matches.length > 1) ambiguous.push({ request, ...candidatesOf(matches) })
    else addTarget(matches[0] as CatalogModule)
  }
  for (const entry of picked) addTarget(entry)

  const coreModuleIds = context.coreModuleIds ?? []
  const presetModules = context.presetModules ?? []
  // A requirement is a module ID, or the npm name of a package the preset registers modules from.
  const enabledInPreset = (requirement: string) =>
    presetModuleIds === null ||
    presetModuleIds.some((id) => sameName(id, requirement)) ||
    presetModules.some((module) => sameName(module.from.replace(/^npm:/i, ''), requirement.replace(/^npm:/i, '')))

  const visit = (entry: CatalogModule, reason: SelectedModule['reason'], trail: Set<string>) => {
    const key = moduleKey(entry)
    if (trail.has(key)) return
    trail.add(key)
    for (const requires of entry.requires) {
      // A core module is satisfied by core, never by a package that replaces it, unless the user asked for that one.
      const core = coreRequirement(requires, coreModuleIds)
      const requirement = core ?? requires
      let matches = findCatalogModules(requirement, core === null ? selectable : targets).filter(
        (candidate) => moduleKey(candidate) !== key,
      )
      if (new Set(matches.map((match) => match.from)).size > 1) {
        // Packages that share a module id: only the one the user asked for can satisfy the requirement.
        const wanted = matches.filter((match) => targets.some((target) => moduleKey(target) === moduleKey(match)))
        if (new Set(wanted.map((match) => match.from)).size !== 1) {
          if (!ambiguous.some((item) => item.request === requirement && item.requiredBy === entry.id)) {
            ambiguous.push({ request: requirement, ...candidatesOf(matches), requiredBy: entry.id })
          }
          continue
        }
        matches = wanted
      }
      if (matches.length > 0) {
        for (const match of matches) visit(match, 'required', trail)
        continue
      }
      if (!enabledInPreset(requirement) && !unmetRequires.some((item) => item.id === entry.id && item.requires === requirement)) {
        unmetRequires.push({ id: entry.id, requires: requirement })
      }
    }
    if (!selected.some((item) => moduleKey(item.entry) === key)) selected.push({ entry, reason })
  }

  for (const target of targets) {
    const existing = selected.find((item) => moduleKey(item.entry) === moduleKey(target))
    if (existing) existing.reason = 'requested'
    else visit(target, 'requested', new Set())
  }
  return { selected, unknown, ambiguous, unmetRequires }
}

export function installCommands(selection: CatalogSelection): string[] {
  return [...new Set(selection.selected.map((item) => item.entry.install))]
}

export function buildSelectionFile(
  catalogUrl: string,
  index: PickerIndex,
  line: string,
  selection: CatalogSelection,
): CatalogSelectionFile {
  return {
    schemaVersion: 1,
    catalog: catalogUrl,
    catalogGeneratedAt: index.generatedAt,
    line,
    modules: selection.selected.map(({ entry, reason }) => ({
      id: entry.id,
      from: entry.from,
      locator: entry.locator,
      source: entry.source,
      license: entry.license,
      tier: entry.tier,
      install: entry.install,
      reason,
    })),
    commands: installCommands(selection),
  }
}

export function writeSelectionFile(targetDir: string, file: CatalogSelectionFile): string {
  const target = join(targetDir, CATALOG_SELECTION_FILE)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(file, null, 2)}\n`)
  return target
}

export function describeModule(entry: CatalogModule, line: string): string {
  const license = entry.license.spdx ?? entry.license.kind
  const level = entry.tier === 'verified' ? `verified on ${line}` : `listed, installs on ${line}`
  return `${entry.source} · ${license} · ${level}`
}
