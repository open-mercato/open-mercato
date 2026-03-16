import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import type { PackageResolver } from './resolver'

type PackageJsonRecord = {
  name?: string
  version?: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  'open-mercato'?: unknown
}

export type OpenMercatoModulePackageMetadata = {
  kind: 'module-package'
  moduleId: string
  ejectable: boolean
}

export type ModuleInfoSnapshot = {
  name?: string
  title?: string
  description?: string
  ejectable?: boolean
}

export type ValidatedOfficialModulePackage = {
  packageName: string
  packageRoot: string
  packageJson: PackageJsonRecord
  metadata: OpenMercatoModulePackageMetadata
  moduleInfo: ModuleInfoSnapshot
  sourceModuleDir: string
  distModuleDir: string
}

const SOURCE_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']
const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules'])
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

function parseOpenMercatoMetadata(
  packageJson: PackageJsonRecord,
  packageName: string,
): OpenMercatoModulePackageMetadata {
  const rawMetadata = packageJson['open-mercato']
  if (!rawMetadata || typeof rawMetadata !== 'object') {
    throw new Error(`Package "${packageName}" is missing the "open-mercato" manifest block.`)
  }

  const metadata = rawMetadata as Partial<OpenMercatoModulePackageMetadata>

  if (metadata.kind !== 'module-package') {
    throw new Error(`Package "${packageName}" is not an official module package (missing open-mercato.kind === "module-package").`)
  }

  if (typeof metadata.moduleId !== 'string' || !/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(metadata.moduleId)) {
    throw new Error(`Package "${packageName}" has an invalid open-mercato.moduleId.`)
  }

  if (typeof metadata.ejectable !== 'boolean') {
    throw new Error(`Package "${packageName}" is missing open-mercato.ejectable.`)
  }

  return metadata as OpenMercatoModulePackageMetadata
}

function parseModuleInfo(indexPath: string): ModuleInfoSnapshot {
  if (!fs.existsSync(indexPath)) {
    return {}
  }

  const source = fs.readFileSync(indexPath, 'utf8')
  const result: ModuleInfoSnapshot = {}

  const nameMatch = source.match(/\bname\s*:\s*['"]([^'"]+)['"]/)
  if (nameMatch) {
    result.name = nameMatch[1]
  }

  const titleMatch = source.match(/\btitle\s*:\s*['"]([^'"]+)['"]/)
  if (titleMatch) {
    result.title = titleMatch[1]
  }

  const descriptionMatch = source.match(/\bdescription\s*:\s*['"]([^'"]+)['"]/)
  if (descriptionMatch) {
    result.description = descriptionMatch[1]
  }

  const ejectableMatch = source.match(/\bejectable\s*:\s*(true|false)/)
  if (ejectableMatch) {
    result.ejectable = ejectableMatch[1] === 'true'
  }

  return result
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
  packageName: string,
): string | null {
  let currentPath = fs.statSync(resolvedPath).isDirectory()
    ? resolvedPath
    : path.dirname(resolvedPath)

  while (currentPath !== path.dirname(currentPath)) {
    const packageJsonPath = path.join(currentPath, 'package.json')
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = readPackageJson(packageJsonPath)
      if (packageJson.name === packageName) {
        return currentPath
      }
    }
    currentPath = path.dirname(currentPath)
  }

  return null
}

function resolveInstalledPackageRootWithRequire(packageName: string, appDir: string): string | null {
  const specifiers = [`${packageName}/package.json`, packageName]

  for (const specifier of specifiers) {
    try {
      const resolvedPath = requireFromCli.resolve(specifier, {
        paths: [appDir],
      })
      const packageRoot =
        specifier === packageName
          ? findResolvedPackageRoot(resolvedPath, packageName)
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

  throw new Error(`Package "${packageName}" is not installed in ${resolver.getAppDir()}.`)
}

export function readOfficialModulePackageFromRoot(
  packageRoot: string,
  expectedPackageName?: string,
): ValidatedOfficialModulePackage {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Package manifest not found at ${packageJsonPath}.`)
  }

  const packageJson = readPackageJson(packageJsonPath)
  const packageName = packageJson.name
  if (!packageName || !packageName.startsWith('@open-mercato/')) {
    throw new Error(`Package at ${packageRoot} is not under the @open-mercato scope.`)
  }

  if (expectedPackageName && packageName !== expectedPackageName) {
    throw new Error(`Resolved package "${packageName}" does not match requested package "${expectedPackageName}".`)
  }

  const metadata = parseOpenMercatoMetadata(packageJson, packageName)
  const sourceModuleDir = path.join(packageRoot, 'src', 'modules', metadata.moduleId)
  const distModuleDir = path.join(packageRoot, 'dist', 'modules', metadata.moduleId)

  if (!fs.existsSync(sourceModuleDir)) {
    throw new Error(`Package "${packageName}" is missing src/modules/${metadata.moduleId}.`)
  }

  if (!fs.existsSync(distModuleDir)) {
    throw new Error(`Package "${packageName}" is missing dist/modules/${metadata.moduleId}.`)
  }

  const moduleInfo = parseModuleInfo(path.join(sourceModuleDir, 'index.ts'))
  if (moduleInfo.name && moduleInfo.name !== metadata.moduleId) {
    throw new Error(
      `Package "${packageName}" declares open-mercato.moduleId "${metadata.moduleId}", but module metadata.name is "${moduleInfo.name}".`,
    )
  }

  return {
    packageName,
    packageRoot,
    packageJson,
    metadata,
    moduleInfo,
    sourceModuleDir,
    distModuleDir,
  }
}

export function resolveInstalledOfficialModulePackage(
  resolver: PackageResolver,
  packageName: string,
): ValidatedOfficialModulePackage {
  const packageRoot = resolveInstalledPackageRoot(resolver, packageName)
  return readOfficialModulePackageFromRoot(packageRoot, packageName)
}

export function validateSourceModeBoundaries(modulePackage: ValidatedOfficialModulePackage): void {
  const violations = collectBoundaryViolations(modulePackage.sourceModuleDir)
  if (violations.length === 0) {
    return
  }

  throw new Error(
    [
      `Package "${modulePackage.packageName}" cannot be installed in source mode because it imports files outside src/modules/${modulePackage.metadata.moduleId}.`,
      'Invalid imports:',
      ...violations.map((violation) => `- ${violation}`),
    ].join('\n'),
  )
}
