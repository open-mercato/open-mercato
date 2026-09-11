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

/** App-local modules always live under this app-root-relative directory. */
export const LOCAL_MODULES_DIRECTORY = path.posix.join('src', 'modules')

/**
 * Locates an app-local module that is projected into the reference bundle rather than the
 * normal package outputs. `appRoot` is the directory containing `src/modules` — the
 * create-app template root at build time, the generated app root at scaffold and
 * `agentic:init` time — so the same module yields the same portable `src/modules/<id>`
 * provenance from every root. Returns `null` when the module is absent or is not readable
 * TypeScript source, because a reference bundle built from an unreadable root would claim
 * an empty surface rather than fail.
 */
export function discoverLocalReferenceModuleSource(options: {
  appRoot: string
  moduleId: string
}): ModuleFactSource | null {
  const moduleRoot = path.join(options.appRoot, 'src', 'modules', options.moduleId)
  if (!hasReadableModuleSource(moduleRoot)) return null
  return {
    moduleId: options.moduleId,
    moduleRoot,
    portableSourceRoot: path.posix.join(LOCAL_MODULES_DIRECTORY, options.moduleId),
    sourceKind: 'local-reference',
  }
}

/**
 * Every enabled `@app` module with readable TypeScript source under `src/modules/<id>`.
 * Disabled directories stay out: their surfaces are inert, so a fact sheet would claim
 * behavior the app does not run.
 */
export function discoverAppLocalModuleSources(resolver: PackageResolver): ModuleFactSource[] {
  const appDir = resolver.getAppDir()
  const sources: ModuleFactSource[] = []
  const seen = new Set<string>()
  for (const entry of resolver.loadEnabledModules()) {
    if (entry.from !== '@app' || seen.has(entry.id)) continue
    seen.add(entry.id)
    const source = discoverLocalReferenceModuleSource({ appRoot: appDir, moduleId: entry.id })
    if (source) sources.push(source)
  }
  return sources.sort((left, right) => left.moduleId.localeCompare(right.moduleId))
}

/**
 * Appends the local reference source to the package batch, rejecting a duplicate module
 * id *before* assignment. A package that already provides the same id would otherwise be
 * silently replaced by (or silently replace) the app-local projection, and the emitted
 * bundle would attribute one module's surfaces to the other's source tree.
 */
export function appendLocalReferenceModuleSource(
  packageSources: readonly ModuleFactSource[],
  reference: ModuleFactSource,
): ModuleFactSource[] {
  const conflict = packageSources.find((source) => source.moduleId === reference.moduleId)
  if (conflict) {
    throw new Error(
      `[module-facts] local reference module "${reference.moduleId}" collides with the module provided by `
      + `${conflict.from ?? '<unknown package>'}. Rename the app-local module or remove the package providing it.`,
    )
  }
  return [...packageSources, reference]
}
