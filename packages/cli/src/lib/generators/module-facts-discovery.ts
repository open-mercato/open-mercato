import fs from 'node:fs'
import path from 'node:path'
import type { PackageResolver } from '../resolver'
import { discoverModulesInPackage } from '../module-package'
import type { ModuleFactSource } from './module-facts'

const READABLE_CONVENTION_FILES = [
  'index',
  'acl',
  'events',
  'di',
  path.join('data', 'entities'),
  path.join('db', 'entities'),
]

/**
 * True when the module directory exposes at least one recognised convention file as
 * TypeScript source. This is the auto-discovery boundary that skips `.js`-only
 * installs (standalone `node_modules/@open-mercato/<pkg>/dist/modules`) — the extractor's
 * ts-morph reader only parses `.ts`/`.tsx`, so a `.js`-only root would yield empty facts.
 */
export function hasReadableModuleSource(moduleRoot: string): boolean {
  if (!fs.existsSync(moduleRoot)) return false
  for (const basename of READABLE_CONVENTION_FILES) {
    for (const extension of ['.ts', '.tsx']) {
      if (fs.existsSync(path.join(moduleRoot, `${basename}${extension}`))) return true
    }
  }
  return false
}

function resolveDuplicateModuleIds(
  sources: ModuleFactSource[],
  resolver: PackageResolver,
): ModuleFactSource[] {
  const sourcesByModule = new Map<string, ModuleFactSource[]>()
  for (const source of sources) {
    const matches = sourcesByModule.get(source.moduleId) ?? []
    matches.push(source)
    sourcesByModule.set(source.moduleId, matches)
  }

  const duplicates = [...sourcesByModule.entries()].filter(([, matches]) => matches.length > 1)
  if (duplicates.length === 0) return sources

  const selectedProviders = new Map<string, Set<string>>()
  const implicitCoreSelections = new Set<string>()
  for (const entry of resolver.loadEnabledModules()) {
    const providers = selectedProviders.get(entry.id) ?? new Set<string>()
    providers.add(entry.from ?? '@open-mercato/core')
    selectedProviders.set(entry.id, providers)
    if (entry.from === undefined) implicitCoreSelections.add(entry.id)
  }

  const selectedSources = new Map<string, ModuleFactSource>()
  for (const [moduleId, matches] of duplicates) {
    const providers = [...new Set(matches.map((source) => source.from ?? '<unknown>'))]
      .sort((left, right) => left.localeCompare(right))
    const configuredProviders = [...(selectedProviders.get(moduleId) ?? [])]
      .sort((left, right) => left.localeCompare(right))
    const selected = configuredProviders.length === 1
      ? matches.filter((source) => source.from === configuredProviders[0])
      : []

    if (selected.length !== 1) {
      const configured = configuredProviders.length > 0
        ? implicitCoreSelections.has(moduleId)
          ? '; src/modules.ts omits "from", which defaults to @open-mercato/core'
          : `; src/modules.ts selects ${configuredProviders.join(', ')}`
        : '; src/modules.ts does not select a provider'
      throw new Error(
        `[module-facts] duplicate module id "${moduleId}" is provided by ${providers.join(', ')}${configured}. `
        + 'Select exactly one matching provider in src/modules.ts.',
      )
    }
    selectedSources.set(moduleId, selected[0])
  }

  const emitted = new Set<string>()
  const result: ModuleFactSource[] = []
  for (const source of sources) {
    if (emitted.has(source.moduleId)) continue
    emitted.add(source.moduleId)
    result.push(selectedSources.get(source.moduleId) ?? source)
  }
  return result
}

/**
 * Package-scan discovery for the create-app build: every package-provided module
 * across `@open-mercato/*` workspace packages (core plus others), never `apps/*`
 * demo modules. Routes through the resolver rather than hardcoded paths.
 */
export function discoverPackageModuleSources(resolver: PackageResolver): ModuleFactSource[] {
  const sources: ModuleFactSource[] = []
  for (const pkg of resolver.discoverPackages()) {
    for (const discovered of discoverModulesInPackage(pkg.path)) {
      const moduleRoot = path.join(pkg.modulesPath, discovered.moduleId)
      if (!hasReadableModuleSource(moduleRoot)) continue
      sources.push({
        moduleId: discovered.moduleId,
        moduleRoot,
        from: pkg.name,
        packageVersion: pkg.version ?? null,
      })
    }
  }
  return resolveDuplicateModuleIds(sources, resolver)
}
