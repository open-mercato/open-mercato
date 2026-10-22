import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import ts from 'typescript-js'
import type { PackageResolver } from './resolver'
import { normalizeModuleLocator } from '@open-mercato/shared/modules/module-locators'

type PackageJsonRecord = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  exports?: unknown
}

export type ModulePackageMetadata = {
  moduleId: string
  ejectable: boolean
}

export type ModuleInfoSnapshot = {
  title?: string
  description?: string
  requires?: string[]
  locator?: string
}

export type ValidatedOfficialModulePackage = {
  packageName: string
  packageRoot: string
  packageJson: PackageJsonRecord
  metadata: ModulePackageMetadata
  moduleInfo: ModuleInfoSnapshot
  sourceModuleDir: string
  distModuleDir: string
}

type DiscoveredModule = {
  moduleId: string
  ejectable: boolean
}

const SOURCE_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules'])
const MODULE_ID_PATTERN = /^[a-z0-9]+(?:_[a-z0-9]+)*$/
const requireFromCli = createRequire(path.join(process.cwd(), 'package.json'))

function shouldSkipEntryName(name: string): boolean {
  return SKIP_DIRS.has(name) || name === '.DS_Store' || name.startsWith('._')
}

function readPackageJson(packageJsonPath: string): PackageJsonRecord {
  try {
    const raw = fs.readFileSync(packageJsonPath, 'utf8')
    return JSON.parse(raw) as PackageJsonRecord
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Failed to read package manifest at ${packageJsonPath}: ${message}`)
  }
}

function readPropertyName(property: ts.ObjectLiteralElementLike): string | null {
  if (!('name' in property) || !property.name) return null
  return ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name)
    ? property.name.text
    : null
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression)
    || ts.isTypeAssertionExpression(expression)
    || ts.isParenthesizedExpression(expression)
    || ts.isSatisfiesExpression(expression)
  ) {
    return unwrapExpression(expression.expression)
  }
  return expression
}

function findMetadataLiteral(source: string, indexPath: string): ts.ObjectLiteralExpression | null {
  const sourceFile = ts.createSourceFile(indexPath, source, ts.ScriptTarget.Latest, true)
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name)
        || declaration.name.text !== 'metadata'
        || !declaration.initializer
      ) continue
      const initializer = unwrapExpression(declaration.initializer)
      if (ts.isObjectLiteralExpression(initializer)) return initializer
    }
  }
  return null
}

function parseModuleInfo(indexPath: string, validateRequires = false): {
  title?: string
  description?: string
  ejectable?: boolean
  locator?: string
  requires: string[]
} {
  if (!fs.existsSync(indexPath)) return { requires: [] }

  const source = fs.readFileSync(indexPath, 'utf8')
  const metadata = findMetadataLiteral(source, indexPath)
  const result: { title?: string; description?: string; ejectable?: boolean; locator?: string; requires: string[] } = {
    requires: [],
  }
  if (!metadata) return result

  for (const property of metadata.properties) {
    const propertyName = readPropertyName(property)
    if (!ts.isPropertyAssignment(property)) {
      if (validateRequires && propertyName === 'requires') {
        throw new Error(`Module descriptor at ${indexPath} must declare "requires" as a static string array.`)
      }
      continue
    }
    const initializer = unwrapExpression(property.initializer)

    if ((propertyName === 'title' || propertyName === 'description' || propertyName === 'locator') && ts.isStringLiteralLike(initializer)) {
      result[propertyName] = initializer.text
      continue
    }

    if (propertyName === 'ejectable') {
      if (initializer.kind === ts.SyntaxKind.TrueKeyword) result.ejectable = true
      if (initializer.kind === ts.SyntaxKind.FalseKeyword) result.ejectable = false
      continue
    }

    if (propertyName !== 'requires') continue
    if (!ts.isArrayLiteralExpression(initializer)) {
      if (validateRequires) {
        throw new Error(`Module descriptor at ${indexPath} must declare "requires" as a static string array.`)
      }
      continue
    }
    if (initializer.elements.some((element) => !ts.isStringLiteralLike(element))) {
      if (validateRequires) {
        throw new Error(`Module descriptor at ${indexPath} must contain only string module ids in "requires".`)
      }
      continue
    }
    result.requires = initializer.elements.map((element) => (element as ts.StringLiteralLike).text)
  }

  return result
}

export function discoverModulesInPackage(packageRoot: string): DiscoveredModule[] {
  const srcModulesDir = path.join(packageRoot, 'src', 'modules')
  const distModulesDir = path.join(packageRoot, 'dist', 'modules')

  const enumerationDir = fs.existsSync(srcModulesDir)
    ? srcModulesDir
    : fs.existsSync(distModulesDir)
      ? distModulesDir
      : null

  if (!enumerationDir) return []

  const modules: DiscoveredModule[] = []

  for (const entry of fs.readdirSync(enumerationDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || shouldSkipEntryName(entry.name) || !MODULE_ID_PATTERN.test(entry.name)) continue

    const moduleId = entry.name
    const srcIndexPath = path.join(packageRoot, 'src', 'modules', moduleId, 'index.ts')
    const distIndexPath = path.join(packageRoot, 'dist', 'modules', moduleId, 'index.js')
    const indexPath = fs.existsSync(srcIndexPath) ? srcIndexPath : distIndexPath

    const info = parseModuleInfo(indexPath)
    modules.push({ moduleId, ejectable: info.ejectable ?? false })
  }

  return modules
}

function resolveRelativeImportTarget(sourceFile: string, importPath: string): string | null {
  if (!importPath.startsWith('.')) return null

  const basePath = path.resolve(path.dirname(sourceFile), importPath)
  const candidates = [basePath]

  for (const ext of SOURCE_FILE_EXTENSIONS) {
    candidates.push(`${basePath}${ext}`)
    candidates.push(path.join(basePath, `index${ext}`))
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = []
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (shouldSkipEntryName(entry.name)) continue

    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }

    const ext = path.extname(entry.name)
    if (!SOURCE_FILE_EXTENSIONS.includes(ext)) continue
    files.push(fullPath)
  }

  return files
}

function collectBoundaryViolations(moduleDir: string): string[] {
  const modulesRoot = path.resolve(moduleDir, '..')
  const modulePrefix = `${moduleDir}${path.sep}`
  const modulesPrefix = `${modulesRoot}${path.sep}`
  const files = collectSourceFiles(moduleDir)
  const violations = new Set<string>()

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, 'utf8')
    const matches = [
      ...content.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
      ...content.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
    ]

    for (const match of matches) {
      const specifier = match[1]
      if (!specifier) continue
      const resolvedTarget = resolveRelativeImportTarget(filePath, specifier)
      if (!resolvedTarget) continue
      if (resolvedTarget.startsWith(modulePrefix)) continue
      if (resolvedTarget.startsWith(modulesPrefix)) continue

      const relativeSource = path.relative(moduleDir, filePath).split(path.sep).join('/')
      const relativeTarget = path.relative(path.dirname(filePath), resolvedTarget).split(path.sep).join('/')
      violations.add(`${relativeSource} -> ${relativeTarget}`)
    }
  }

  return Array.from(violations).sort((left, right) => left.localeCompare(right))
}

function findResolvedPackageRoot(
  resolvedPath: string,
): string | null {
  let currentPath = fs.statSync(resolvedPath).isDirectory()
    ? resolvedPath
    : path.dirname(resolvedPath)

  while (currentPath !== path.dirname(currentPath)) {
    const packageJsonPath = path.join(currentPath, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath)
      if (typeof packageJson.name === 'string' && normalizeModuleLocator(`npm:${packageJson.name}`) === `npm:${packageJson.name}`) {
        return currentPath
      }
    }
    currentPath = path.dirname(currentPath)
  }

  return null
}

export function resolveInstalledPackageRootWithRequire(packageName: string, appDir: string): string | null {
  const specifiers = [`${packageName}/package.json`, packageName]

  for (const specifier of specifiers) {
    try {
      const resolvedPath = requireFromCli.resolve(specifier, {
        paths: [appDir],
      })
      const packageRoot =
        specifier === packageName
          ? findResolvedPackageRoot(resolvedPath)
          : path.dirname(resolvedPath)

      if (packageRoot) {
        return packageRoot
      }
    } catch {
      continue
    }
  }

  return null
}

export function parsePackageNameFromSpec(packageSpec: string): string | null {
  const trimmed = packageSpec.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('@')) {
    const slashIndex = trimmed.indexOf('/')
    if (slashIndex < 0) return null
    const versionSeparator = trimmed.indexOf('@', slashIndex + 1)
    return versionSeparator < 0 ? trimmed : trimmed.slice(0, versionSeparator)
  }

  const versionSeparator = trimmed.indexOf('@')
  return versionSeparator < 0 ? trimmed : trimmed.slice(0, versionSeparator)
}

export function resolveInstalledPackageRoot(
  resolver: PackageResolver,
  packageName: string,
): string {
  const resolvedWithRequire = resolveInstalledPackageRootWithRequire(packageName, resolver.getAppDir())
  if (resolvedWithRequire) {
    return resolvedWithRequire
  }

  const fallback = resolver.getPackageRoot(packageName)
  if (fs.existsSync(path.join(fallback, 'package.json'))) {
    return fallback
  }

  // In monorepo mode, getPackageRoot resolves to packages/<name> (workspace convention),
  // but externally installed packages land in root node_modules — check there too.
  const nodeModulesFallback = path.join(resolver.getRootDir(), 'node_modules', packageName)
  if (fs.existsSync(path.join(nodeModulesFallback, 'package.json'))) {
    return nodeModulesFallback
  }

  throw new Error(`Package "${packageName}" is not installed in ${resolver.getAppDir()}.`)
}

function resolveEsmExportTarget(value: unknown, substitution?: string): string | null | undefined {
  if (typeof value === 'string') {
    const target = substitution === undefined ? value : value.replaceAll('*', substitution)
    if (!target.startsWith('./') || target.slice(2).split('/').some((segment) => ['..', '.', 'node_modules'].includes(segment))) return undefined
    return target
  }
  if (value === null) return null
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = resolveEsmExportTarget(candidate, substitution)
      if (target !== undefined && target !== null) return target
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const [condition, candidate] of Object.entries(value)) {
      if (!['import', 'node', 'node-addons', 'module-sync', 'default'].includes(condition)) continue
      const target = resolveEsmExportTarget(candidate, substitution)
      if (target !== undefined) return target
    }
  }
  return undefined
}

function resolvePackageSubpathExport(exports: unknown, subpath: string): string | null | undefined {
  if (!exports || typeof exports !== 'object' || Array.isArray(exports)) return undefined
  const entries = Object.entries(exports)
  const direct = entries.find(([key]) => key === subpath)
  if (direct) return resolveEsmExportTarget(direct[1])
  const patterns = entries.filter(([key]) => key.startsWith('./') && key.includes('*'))
    .sort(([left], [right]) => right.indexOf('*') - left.indexOf('*') || right.length - left.length)
  for (const [pattern, target] of patterns) {
    const wildcard = pattern.indexOf('*')
    const prefix = pattern.slice(0, wildcard)
    const suffix = pattern.slice(wildcard + 1)
    if (subpath.startsWith(prefix) && subpath.endsWith(suffix) && subpath.length >= prefix.length + suffix.length) {
      return resolveEsmExportTarget(target, subpath.slice(prefix.length, subpath.length - suffix.length))
    }
  }
  return undefined
}

function isGeneratedModuleImport(relativePath: string): boolean {
  const basename = relativePath.replace(/\.(?:[cm]?js|jsx|ts|tsx)$/, '')
  if (!relativePath.includes('/')) {
    return new Set(['index', 'acl', 'setup', 'cli', 'runtime', 'ce', 'search', 'events', 'notifications', 'notifications.client', 'notifications.handlers', 'translations', 'encryption', 'ai-tools', 'ai-agents', 'di']).has(basename)
  }
  return /^(?:api|backend|frontend|portal|subscribers|workers|widgets|commands)\//.test(relativePath)
    || /^(?:data|db)\/entities\.(?:[cm]?js|jsx|ts|tsx)$/.test(relativePath)
    || /^i18n\/[^/]+\.json$/.test(relativePath)
}

export function isModulePackageExportError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'MODULE_PACKAGE_EXPORT_UNAVAILABLE'
}

export function assertModulePackageExports(
  manifest: { exports?: unknown },
  binding: string,
  moduleId: string,
  packageFiles: readonly string[],
): void {
  if (manifest.exports === undefined) return
  const normalizedFiles = new Set(packageFiles.map((file) => file.replaceAll('\\', '/').replace(/^\.\//, '')))
  const prefix = `dist/modules/${moduleId}/`
  for (const file of normalizedFiles) {
    if (!file.startsWith(prefix)) continue
    const relativePath = file.slice(prefix.length)
    if (!isGeneratedModuleImport(relativePath) || !/\.(?:[cm]?js|jsx|json)$/.test(relativePath)) continue
    const publicPath = `./modules/${moduleId}/${relativePath.replace(/\.(?:[cm]?js|jsx)$/, '')}`
    const target = resolvePackageSubpathExport(manifest.exports, publicPath)
    if (!target || !normalizedFiles.has(target.slice(2))) {
      throw Object.assign(new Error(`Package binding "${binding}" cannot import "${binding}/${publicPath.slice(2)}": the package exports do not provide an available ESM target. Keep the current provider and use a package exposing this module subpath before enabling it.`), { code: 'MODULE_PACKAGE_EXPORT_UNAVAILABLE' })
    }
  }
}

export function readOfficialModulePackageFromRoot(
  packageRoot: string,
  expectedPackageName?: string,
  targetModuleId?: string,
): ValidatedOfficialModulePackage {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Package manifest not found at ${packageJsonPath}.`)
  }

  const packageJson = readPackageJson(packageJsonPath)
  const packageName = packageJson.name
  if (!packageName) {
    throw new Error(`Package manifest at ${packageJsonPath} is missing the "name" field.`)
  }

  if (typeof packageName !== 'string' || normalizeModuleLocator(`npm:${packageName}`) !== `npm:${packageName}`) {
    throw new Error(`Package manifest at ${packageJsonPath} has an invalid "name" field.`)
  }

  if (expectedPackageName && packageName !== expectedPackageName) {
    throw new Error(`Resolved package "${packageName}" does not match requested package "${expectedPackageName}".`)
  }

  const discoveredModules = discoverModulesInPackage(packageRoot)

  if (discoveredModules.length === 0) {
    throw new Error(`Package "${packageName}" has no modules in src/modules/ or dist/modules/.`)
  }

  let selected: DiscoveredModule

  if (targetModuleId) {
    const found = discoveredModules.find((m) => m.moduleId === targetModuleId)
    if (!found) {
      const available = discoveredModules.map((m) => m.moduleId).join(', ')
      throw new Error(
        `Package "${packageName}" does not contain module "${targetModuleId}". Available: ${available}`,
      )
    }
    selected = found
  } else {
    if (discoveredModules.length > 1) {
      const available = discoveredModules.map((m) => m.moduleId).join(', ')
      throw new Error(
        `Package "${packageName}" contains multiple modules (${available}). Specify one with --module <moduleId>.`,
      )
    }
    selected = discoveredModules[0]
  }

  const { moduleId } = selected
  const sourceModuleDir = path.join(packageRoot, 'src', 'modules', moduleId)
  const distModuleDir = path.join(packageRoot, 'dist', 'modules', moduleId)

  if (!fs.existsSync(sourceModuleDir)) {
    throw new Error(`Package "${packageName}" is missing src/modules/${moduleId}.`)
  }

  if (!fs.existsSync(distModuleDir)) {
    throw new Error(`Package "${packageName}" is missing dist/modules/${moduleId}.`)
  }

  const info = parseModuleInfo(path.join(sourceModuleDir, 'index.ts'), true)

  return {
    packageName,
    packageRoot,
    packageJson,
    metadata: { moduleId, ejectable: selected.ejectable },
    moduleInfo: { title: info.title, description: info.description, requires: info.requires, ...(info.locator ? { locator: info.locator } : {}) },
    sourceModuleDir,
    distModuleDir,
  }
}

function listPackageFiles(packageRoot: string, directory = packageRoot): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (shouldSkipEntryName(entry.name)) return []
    const fullPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listPackageFiles(packageRoot, fullPath) : [path.relative(packageRoot, fullPath)]
  })
}

export function resolveInstalledOfficialModulePackage(
  resolver: PackageResolver,
  packageName: string,
  moduleId?: string,
): ValidatedOfficialModulePackage {
  const packageRoot = resolveInstalledPackageRoot(resolver, packageName)
  const modulePackage = readOfficialModulePackageFromRoot(packageRoot, undefined, moduleId)
  const packageFiles = listPackageFiles(packageRoot)
  assertModulePackageExports(modulePackage.packageJson, packageName, modulePackage.metadata.moduleId, packageFiles)
  if (modulePackage.packageName !== packageName) {
    const resolvedBindingRoot = resolveInstalledPackageRootWithRequire(packageName, resolver.getAppDir())
    const installedBindingPath = path.join('node_modules', packageName)
    const matchesBindingPath = path.normalize(packageRoot).endsWith(`${path.sep}${installedBindingPath}`)
    if (!matchesBindingPath && (!resolvedBindingRoot || fs.realpathSync(resolvedBindingRoot) !== fs.realpathSync(packageRoot))) {
      throw new Error(`Resolved package "${modulePackage.packageName}" does not match requested package binding "${packageName}".`)
    }
  }
  return modulePackage
}

export function validateEjectBoundaries(modulePackage: ValidatedOfficialModulePackage): void {
  const violations = collectBoundaryViolations(modulePackage.sourceModuleDir)
  if (violations.length === 0) {
    return
  }

  throw new Error(
    [
      `Package "${modulePackage.packageName}" cannot be added with --eject because it imports files outside src/modules/${modulePackage.metadata.moduleId}.`,
      'Invalid imports:',
      ...violations.map((violation) => `- ${violation}`),
    ].join('\n'),
  )
}
