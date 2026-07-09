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

function dedupeById(sources: ModuleFactSource[]): ModuleFactSource[] {
  const seen = new Set<string>()
  const result: ModuleFactSource[] = []
  for (const source of sources) {
    if (seen.has(source.moduleId)) continue
    seen.add(source.moduleId)
    result.push(source)
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
      sources.push({ moduleId: discovered.moduleId, moduleRoot, from: pkg.name })
    }
  }
  return dedupeById(sources)
}
