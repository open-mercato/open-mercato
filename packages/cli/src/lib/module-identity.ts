import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript-js'
import { normalizeModuleLocator, type ModuleIdentity } from '@open-mercato/shared/modules/module-locators'
import type { ModuleEntry, PackageResolver } from './resolver'
import { resolveInstalledPackageRoot } from './module-package'

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

export function getModuleLocators(entry: ModuleEntry, resolver: PackageResolver): string[] {
  const locators = new Set<string>()
  const add = (value: unknown): void => {
    if (typeof value !== 'string') return
    const identity = normalizeModuleLocator(value)
    if (identity && (identity.startsWith('npm:') || identity.startsWith('github:'))) locators.add(identity)
  }
  const from = entry.from ?? '@open-mercato/core'
  if (from === '@app') {
    if (entry.packageName) add(`npm:${entry.packageName}`)
    add(entry.locator ?? readMetadataLocator(resolver.getModulePaths(entry).appBase))
  } else {
    let packageRoot = resolver.getPackageRoot(from)
    try { packageRoot = resolveInstalledPackageRoot(resolver, from) } catch {}
    const manifest = readJson(path.join(packageRoot, 'package.json'))
    add(`npm:${from}`)
    if (typeof manifest.name === 'string' && manifest.name !== from) return [...locators]
    const appManifest = readJson(path.join(resolver.getAppDir(), 'package.json'))
    let dependencyLocator: string | undefined
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const dependencies = appManifest[section]
      if (dependencies && typeof dependencies === 'object' && !Array.isArray(dependencies)) {
        const specifier = (dependencies as Record<string, unknown>)[from]
        if (typeof specifier === 'string' && /^(?:github:|github\.com\/|(?:git\+)?https?:\/\/github\.com\/|git@github\.com:|(?:git\+)?ssh:\/\/|[a-z0-9][a-z0-9-]*\/[a-z0-9._-]+(?:[#@]|$))/i.test(specifier) && normalizeModuleLocator(specifier)?.startsWith('github:')) dependencyLocator = specifier
      }
    }
    if (dependencyLocator) add(dependencyLocator)
    else {
      const repository = manifest.repository
      if (typeof repository === 'string') add(repository)
      else if (repository && typeof repository === 'object' && !Array.isArray(repository)) {
        const details = repository as Record<string, unknown>
        if (!details.directory) add(details.url)
      }
      if (![...locators].some((locator) => locator.startsWith('github:'))) {
        const registeredLocator = entry.locator ? normalizeModuleLocator(entry.locator) : null
        if (registeredLocator?.startsWith('github:')) add(registeredLocator)
        const directoryScoped = repository && typeof repository === 'object' && !Array.isArray(repository) && Boolean((repository as Record<string, unknown>).directory)
        if (!registeredLocator?.startsWith('github:') && !directoryScoped) {
          const metadataBase = [path.join(packageRoot, 'src', 'modules', entry.id), path.join(packageRoot, 'dist', 'modules', entry.id), resolver.getModulePaths(entry).pkgBase].find((candidate) => fs.existsSync(candidate))
          const metadataLocator = metadataBase ? readMetadataLocator(metadataBase) : undefined
          if (metadataLocator && normalizeModuleLocator(metadataLocator)?.startsWith('github:')) add(metadataLocator)
        }
      }
    }
  }
  return [...locators]
}

export function getEnabledModuleIdentities(resolver: PackageResolver): ModuleIdentity[] {
  return resolver.loadEnabledModules().map((entry) => ({ id: entry.id, locators: getModuleLocators(entry, resolver) }))
}
