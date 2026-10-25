import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogModule, CatalogSelectionFile, PickerIndex } from './types.js'

export const CATALOG_SELECTION_FILE = join('.mercato', 'catalog-selection.json')

export type SelectedModule = { entry: CatalogModule; reason: 'requested' | 'required' }

export type CatalogSelection = {
  selected: SelectedModule[]
  unknown: string[]
  /**
   * Requests and requirements several catalog modules match. `pass` says what tells them apart: the module id for
   * modules of one package, the npm name for packages that share a module id. `requiredBy` names the module whose
   * `requires` entry is ambiguous.
   */
  ambiguous: { request: string; candidates: string[]; pass: 'module id' | 'npm name'; requiredBy?: string }[]
  unmetRequires: { id: string; requires: string }[]
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

/** Modules matching a `--modules` item by ID, npm name or locator (`npm:<name>`). */
export function findCatalogModules(request: string, modules: readonly CatalogModule[]): CatalogModule[] {
  const name = request.replace(/^npm:/i, '')
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
): CatalogSelection {
  const selected: SelectedModule[] = []
  const unknown: string[] = []
  const ambiguous: CatalogSelection['ambiguous'] = []
  const unmetRequires: CatalogSelection['unmetRequires'] = []
  const targets: CatalogModule[] = []
  const addTarget = (entry: CatalogModule) => {
    if (!targets.some((target) => moduleKey(target) === moduleKey(entry))) targets.push(entry)
  }
  const candidatesOf = (matches: readonly CatalogModule[]) => {
    const packages = new Set(matches.map((match) => match.from))
    return packages.size > 1
      ? { candidates: matches.map((match) => `${match.id} from ${match.from}`), pass: 'npm name' as const }
      : { candidates: matches.map((match) => match.id), pass: 'module id' as const }
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

  const visit = (entry: CatalogModule, reason: SelectedModule['reason'], trail: Set<string>) => {
    const key = moduleKey(entry)
    if (trail.has(key)) return
    trail.add(key)
    for (const requirement of entry.requires) {
      let matches = findCatalogModules(requirement, selectable).filter((candidate) => moduleKey(candidate) !== key)
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
      const enabledInPreset = presetModuleIds === null || presetModuleIds.includes(requirement)
      if (!enabledInPreset && !unmetRequires.some((item) => item.id === entry.id && item.requires === requirement)) {
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
