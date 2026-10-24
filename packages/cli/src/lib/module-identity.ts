import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { normalizeModuleLocator, type ModuleIdentity } from '@open-mercato/shared/modules/module-locators'
import type { ModuleEntry, PackageResolver } from './resolver'

function readJson(filePath: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readMetadataLocator(moduleBase: string): string | undefined {
  const indexPath = ['index.ts', 'index.js'].map((name) => path.join(moduleBase, name)).find((candidate) => fs.existsSync(candidate))
  if (!indexPath) return undefined
  const source = ts.createSourceFile(indexPath, fs.readFileSync(indexPath, 'utf8'), ts.ScriptTarget.Latest, true)
  let locator: string | undefined
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'metadata' && node.initializer) {
      let initializer = node.initializer
      while (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer) || ts.isParenthesizedExpression(initializer)) initializer = initializer.expression
      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          if (ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)) && property.name.text === 'locator' && ts.isStringLiteralLike(property.initializer)) locator = property.initializer.text
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return locator
}

function sourceLocator(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const locator = normalizeModuleLocator(value)
  return locator?.startsWith('npm:') || locator?.startsWith('github:') ? locator : undefined
}

function installedDependencyLocator(specifier: unknown, canonicalName: string | undefined): string | undefined {
  if (typeof specifier !== 'string') return undefined
  if (/^(?:github:|github\.com\/|(?:git\+)?https?:\/\/github\.com\/|git@github\.com:|(?:git\+)?ssh:\/\/|[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+(?:[#@]|$))/i.test(specifier)) {
    const locator = sourceLocator(specifier)
    return locator?.startsWith('github:') ? locator : undefined
  }
  if (specifier.startsWith('npm:')) {
    const aliasTarget = specifier.match(/^npm:(@[^/]+\/[^@]+|[^@]+)(?:@.+)?$/)?.[1]
    return aliasTarget ? sourceLocator(`npm:${aliasTarget}`) : undefined
  }
  if (!canonicalName || /^(?:[a-z][a-z0-9+.-]*:|[./]|https?:)/i.test(specifier)) return undefined
  return sourceLocator(`npm:${canonicalName}`)
}

function assertDeclaredIdentity(entry: ModuleEntry, observedLocator: string | undefined, canonicalName: string | undefined): void {
  const binding = entry.from ?? '@open-mercato/core'
  if (entry.packageName && canonicalName && entry.packageName !== canonicalName) {
    throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${binding}': declared package '${entry.packageName}' disagrees with installed package '${canonicalName}'. Restore the intended binding or correct src/modules.ts, then regenerate.`)
  }
  const declaredLocator = sourceLocator(entry.locator)
  if (declaredLocator && observedLocator && declaredLocator !== observedLocator) {
    throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${binding}': declared origin '${declaredLocator}' disagrees with observed origin '${observedLocator}'. Disable the old provider before replacing it, then regenerate.`)
  }
  if (declaredLocator?.startsWith('npm:') && canonicalName && declaredLocator !== sourceLocator(`npm:${canonicalName}`)) {
    throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${binding}': declared origin '${declaredLocator}' disagrees with installed package '${canonicalName}'. Correct src/modules.ts to select the intended provider, then regenerate.`)
  }
}

function readModuleLocators(
  entry: ModuleEntry,
  resolver: PackageResolver,
  appManifest: Record<string, unknown>,
  packageManifests: Map<string, Record<string, unknown>>,
): string[] {
  const from = entry.from ?? '@open-mercato/core'
  if (from === '@app') {
    const retainedLocator = sourceLocator(entry.locator ?? readMetadataLocator(resolver.getModulePaths(entry).appBase))
    assertDeclaredIdentity(entry, retainedLocator, entry.packageName)
    return retainedLocator ? [retainedLocator] : []
  }

  let manifest = packageManifests.get(from)
  if (!manifest) {
    manifest = readJson(path.join(resolver.getPackageRoot(from), 'package.json'))
    packageManifests.set(from, manifest)
  }
  const canonicalName = typeof manifest.name === 'string' ? manifest.name : undefined
  const observedLocators = new Set<string>()
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    const dependencies = appManifest[section]
    if (!dependencies || typeof dependencies !== 'object' || Array.isArray(dependencies)) continue
    const specifier = (dependencies as Record<string, unknown>)[from]
    const locator = installedDependencyLocator(specifier, canonicalName)
    if (locator?.startsWith('npm:') && canonicalName !== from && typeof specifier === 'string' && !specifier.startsWith('npm:')) {
      throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${from}': installed package '${canonicalName}' does not match the dependency binding. Restore the intended package or declare an explicit npm alias, then regenerate.`)
    }
    if (locator) observedLocators.add(locator)
  }
  if (observedLocators.size > 1) {
    throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${from}': dependency sections declare conflicting origins. Keep one provider for this binding in package.json, then regenerate.`)
  }
  const observedLocator = [...observedLocators][0]
  if (observedLocator?.startsWith('npm:') && canonicalName && observedLocator !== sourceLocator(`npm:${canonicalName}`)) {
    throw new Error(`[modules] Cannot resolve module '${entry.id}' from binding '${from}': dependency origin '${observedLocator}' disagrees with installed package '${canonicalName}'. Restore the intended package through the package manager, then regenerate.`)
  }
  assertDeclaredIdentity(entry, observedLocator, canonicalName)
  const locator = observedLocator ?? sourceLocator(entry.locator)
  return locator ? [locator] : []
}

export function getModuleLocators(entry: ModuleEntry, resolver: PackageResolver): string[] {
  return readModuleLocators(entry, resolver, readJson(path.join(resolver.getAppDir(), 'package.json')), new Map())
}

export function assertUniqueEnabledModuleIds(enabledModules: readonly ModuleEntry[], resolver: PackageResolver): void {
  const byId = new Map<string, ModuleEntry>()
  for (const entry of enabledModules) {
    const existing = byId.get(entry.id)
    if (existing) {
      const describe = (provider: ModuleEntry): string => {
        const binding = provider.from ?? '@open-mercato/core'
        const source = sourceLocator(provider.locator)
        return binding === '@app'
          ? `@app (${resolver.getModulePaths(provider).appBase})${source ? `, origin ${source}` : ''}`
          : `binding '${binding}'${source ? `, origin ${source}` : ''}`
      }
      throw new Error(`[generate] Duplicate enabled module ID '${entry.id}': ${describe(existing)} and ${describe(entry)}. Keep one provider in src/modules.ts, then run yarn mercato generate. Installing under another package alias does not allow both module IDs to run.`)
    }
    byId.set(entry.id, entry)
  }
}

export function getEnabledModuleIdentities(resolver: PackageResolver, enabledModules: readonly ModuleEntry[] = resolver.loadEnabledModules()): ModuleIdentity[] {
  assertUniqueEnabledModuleIds(enabledModules, resolver)
  const appManifest = readJson(path.join(resolver.getAppDir(), 'package.json'))
  const packageManifests = new Map<string, Record<string, unknown>>()
  return enabledModules.map((entry) => ({ id: entry.id, locators: readModuleLocators(entry, resolver, appManifest, packageManifests) }))
}
