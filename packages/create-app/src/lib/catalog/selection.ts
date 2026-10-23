import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { CatalogModule, CatalogSelectionFile, PickerIndex } from './types.js'

export const CATALOG_SELECTION_FILE = join('.mercato', 'catalog-selection.json')

export type SelectedModule = { entry: CatalogModule; reason: 'requested' | 'required' }

export type CatalogSelection = {
  selected: SelectedModule[]
  unknown: string[]
  ambiguous: { request: string; candidates: string[] }[]
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

/** Modules matching a `--modules` item by ID, npm name or locator (`npm:<name>`). */
export function findCatalogModules(request: string, modules: readonly CatalogModule[]): CatalogModule[] {
  const name = request.replace(/^npm:/i, '')
  const byId = modules.filter((entry) => sameName(entry.id, name))
  if (byId.length > 0) return byId
  return modules.filter((entry) => sameName(entry.from, name) || sameName(entry.locator, request))
}

export function resolveCatalogSelection(
  requests: readonly string[],
  selectable: readonly CatalogModule[],
  presetModuleIds: readonly string[] | null,
): CatalogSelection {
  const selected: SelectedModule[] = []
  const unknown: string[] = []
  const ambiguous: CatalogSelection['ambiguous'] = []
  const unmetRequires: CatalogSelection['unmetRequires'] = []
  const has = (entry: CatalogModule) =>
    selected.some((item) => item.entry.id === entry.id && item.entry.from === entry.from)

  const visit = (entry: CatalogModule, reason: SelectedModule['reason'], trail: Set<string>) => {
    const key = `${entry.from}#${entry.id}`
    if (trail.has(key)) return
    trail.add(key)
    for (const requirement of entry.requires) {
      const matches = findCatalogModules(requirement, selectable).filter((candidate) => `${candidate.from}#${candidate.id}` !== key)
      if (matches.length > 0) {
        for (const match of matches) visit(match, 'required', trail)
        continue
      }
      const enabledInPreset = presetModuleIds === null || presetModuleIds.includes(requirement)
      if (!enabledInPreset && !unmetRequires.some((item) => item.id === entry.id && item.requires === requirement)) {
        unmetRequires.push({ id: entry.id, requires: requirement })
      }
    }
    if (!has(entry)) selected.push({ entry, reason })
  }

  for (const request of requests) {
    const matches = findCatalogModules(request, selectable)
    if (matches.length === 0) {
      unknown.push(request)
      continue
    }
    if (matches.length > 1 && !matches.every((match) => match.id === matches[0]?.id)) {
      ambiguous.push({ request, candidates: matches.map((match) => match.id) })
      continue
    }
    const target = matches[0] as CatalogModule
    const existing = selected.find((item) => item.entry.id === target.id && item.entry.from === target.from)
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
