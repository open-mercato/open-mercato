import path from 'node:path'
import fs from 'node:fs'
import { setModuleRegistrationSource } from './modules-config'
import type { PackageResolver, ModuleEntry } from './resolver'
import { resolveInstalledOfficialModulePackage } from './module-package'

type ModuleMetadata = {
  ejectable?: boolean
  title?: string
  description?: string
}

const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules'])
const SOURCE_FILE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

function shouldSkipEntryName(name: string): boolean {
  return SKIP_DIRS.has(name) || name === '.DS_Store' || name.startsWith('._')
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

function rewriteRelativeSpecifier(
  sourceFile: string,
  specifier: string,
  modulesRoot: string,
  moduleId: string,
  packageName: string,
): string {
  const resolvedTarget = resolveRelativeImportTarget(sourceFile, specifier)
  if (!resolvedTarget) return specifier

  const modulesRootPrefix = `${modulesRoot}${path.sep}`
  if (!resolvedTarget.startsWith(modulesRootPrefix)) return specifier

  const relativeFromModules = path.relative(modulesRoot, resolvedTarget)
  let normalizedRelative = relativeFromModules.split(path.sep).join('/')
  const matchedExt = SOURCE_FILE_EXTENSIONS.find((ext) => normalizedRelative.endsWith(ext))
  if (matchedExt) {
    normalizedRelative = normalizedRelative.slice(0, -matchedExt.length)
  }
  if (normalizedRelative.endsWith('/index')) {
    normalizedRelative = normalizedRelative.slice(0, -'/index'.length)
  }
  const segments = normalizedRelative.split('/')
  const targetModuleId = segments[0]

  if (!targetModuleId || targetModuleId === moduleId) return specifier

  return `${packageName}/modules/${normalizedRelative}`
}

export function rewriteCrossModuleImports(
  pkgBase: string,
  appBase: string,
  moduleId: string,
  packageName: string,
): void {
  const modulesRoot = path.resolve(pkgBase, '..')
  const appFiles = collectSourceFiles(appBase)

  for (const appFile of appFiles) {
    const relativePath = path.relative(appBase, appFile)
    const sourceFile = path.join(pkgBase, relativePath)

    if (!fs.existsSync(sourceFile)) continue

    const content = fs.readFileSync(appFile, 'utf8')
    let updated = content

    updated = updated.replace(
      /(\bfrom\s*['"])([^'"]+)(['"])/g,
      (_match, prefix: string, specifier: string, suffix: string) => {
        const rewritten = rewriteRelativeSpecifier(
          sourceFile,
          specifier,
          modulesRoot,
          moduleId,
          packageName,
        )
        return `${prefix}${rewritten}${suffix}`
      },
    )

    updated = updated.replace(
      /(\bimport\s*\(\s*['"])([^'"]+)(['"]\s*\))/g,
      (_match, prefix: string, specifier: string, suffix: string) => {
        const rewritten = rewriteRelativeSpecifier(
          sourceFile,
          specifier,
          modulesRoot,
          moduleId,
          packageName,
        )
        return `${prefix}${rewritten}${suffix}`
      },
    )

    if (updated !== content) {
      fs.writeFileSync(appFile, updated)
    }
  }
}

export function parseModuleMetadata(indexPath: string): ModuleMetadata {
  if (!fs.existsSync(indexPath)) return {}

  const source = fs.readFileSync(indexPath, 'utf8')
  const result: ModuleMetadata = {}

  const ejectableMatch = source.match(/ejectable\s*:\s*(true|false)/)
  if (ejectableMatch) {
    result.ejectable = ejectableMatch[1] === 'true'
  }

  const titleMatch = source.match(/title\s*:\s*['"]([^'"]+)['"]/)
  if (titleMatch) {
    result.title = titleMatch[1]
  }

  const descMatch = source.match(/description\s*:\s*['"]([^'"]+)['"]/)
  if (descMatch) {
    result.description = descMatch[1]
  }

  return result
}

export function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })

  const entries = fs.readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    if (shouldSkipEntryName(entry.name)) continue

    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

export function updateModulesTs(modulesPath: string, moduleId: string): void {
  setModuleRegistrationSource(modulesPath, moduleId, '@app')
}

export type EjectableModule = {
  id: string
  title?: string
  description?: string
  from: string
}

type ResolvedModuleSource = {
  pkgBase: string
  metadata: ModuleMetadata
}

function resolveModuleSource(
  resolver: PackageResolver,
  entry: ModuleEntry,
): ResolvedModuleSource {
  const { pkgBase } = resolver.getModulePaths(entry)
  const fallbackMetadata = parseModuleMetadata(path.join(pkgBase, 'index.ts'))
  const from = entry.from || '@open-mercato/core'

  if (from === '@app' || from === '@open-mercato/core') {
    return { pkgBase, metadata: fallbackMetadata }
  }

  try {
    const modulePackage = resolveInstalledOfficialModulePackage(resolver, from, entry.id)

    return {
      pkgBase: modulePackage.sourceModuleDir,
      metadata: {
        ejectable: modulePackage.metadata.ejectable,
        title: modulePackage.moduleInfo.title ?? modulePackage.metadata.moduleId,
        description: modulePackage.moduleInfo.description,
      },
    }
  } catch {
    return { pkgBase, metadata: fallbackMetadata }
  }
}

export function listEjectableModules(resolver: PackageResolver): EjectableModule[] {
  const modules = resolver.loadEnabledModules()
  const ejectable: EjectableModule[] = []

  for (const entry of modules) {
    if (entry.from === '@app') continue

    const { metadata } = resolveModuleSource(resolver, entry)

    if (metadata.ejectable) {
      ejectable.push({
        id: entry.id,
        title: metadata.title,
        description: metadata.description,
        from: entry.from || '@open-mercato/core',
      })
    }
  }

  return ejectable
}

export function ejectModule(resolver: PackageResolver, moduleId: string): void {
  const modules = resolver.loadEnabledModules()
  const entry = modules.find((m: ModuleEntry) => m.id === moduleId)

  if (!entry) {
    throw new Error(
      `Module "${moduleId}" is not listed in src/modules.ts. ` +
      `Available modules: ${modules.map((m: ModuleEntry) => m.id).join(', ')}`,
    )
  }

  if (entry.from === '@app') {
    throw new Error(
      `Module "${moduleId}" is already local (from: '@app'). Nothing to eject.`,
    )
  }

  const { appBase } = resolver.getModulePaths(entry)
  const { pkgBase, metadata } = resolveModuleSource(resolver, entry)

  if (!fs.existsSync(pkgBase)) {
    throw new Error(
      `Package source directory not found: ${pkgBase}. ` +
      `Make sure the package is installed.`,
    )
  }

  if (!metadata.ejectable) {
    throw new Error(
      `Module "${moduleId}" is not marked as ejectable. Only modules with \`ejectable: true\` in their metadata can be ejected.`,
    )
  }

  if (fs.existsSync(appBase)) {
    throw new Error(
      `Destination directory already exists: ${appBase}. ` +
      `Remove it first or resolve the conflict manually.`,
    )
  }

  copyDirRecursive(pkgBase, appBase)
  rewriteCrossModuleImports(pkgBase, appBase, moduleId, entry.from || '@open-mercato/core')

  const modulesPath = resolver.getModulesConfigPath()
  updateModulesTs(modulesPath, moduleId)
}
