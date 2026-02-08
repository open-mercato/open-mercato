import path from 'node:path'
import fs from 'node:fs'
import type { PackageResolver, ModuleEntry } from './resolver'

type ModuleMetadata = {
  ejectable?: boolean
  title?: string
  description?: string
}

const SKIP_DIRS = new Set(['__tests__', '__mocks__', 'node_modules'])

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
    if (SKIP_DIRS.has(entry.name)) continue

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
  if (!fs.existsSync(modulesPath)) {
    throw new Error(`modules.ts not found at ${modulesPath}`)
  }

  const source = fs.readFileSync(modulesPath, 'utf8')

  // Match the module entry and replace its `from` value with '@app'
  // Handles patterns like: { id: 'currencies', from: '@open-mercato/core' }
  const pattern = new RegExp(
    `(\\{\\s*id:\\s*['"]${moduleId}['"]\\s*,\\s*from:\\s*)'([^']*)'`,
  )
  const patternDouble = new RegExp(
    `(\\{\\s*id:\\s*['"]${moduleId}['"]\\s*,\\s*from:\\s*)"([^"]*)"`,
  )

  let updated = source
  if (pattern.test(source)) {
    updated = source.replace(pattern, `$1'@app'`)
  } else if (patternDouble.test(source)) {
    updated = source.replace(patternDouble, `$1"@app"`)
  } else {
    throw new Error(
      `Could not find module entry for "${moduleId}" in ${modulesPath}. ` +
      `Expected a pattern like: { id: '${moduleId}', from: '...' }`,
    )
  }

  fs.writeFileSync(modulesPath, updated)
}

export type EjectableModule = {
  id: string
  title?: string
  description?: string
  from: string
}

export function listEjectableModules(resolver: PackageResolver): EjectableModule[] {
  const modules = resolver.loadEnabledModules()
  const ejectable: EjectableModule[] = []

  for (const entry of modules) {
    if (entry.from === '@app') continue

    const { pkgBase } = resolver.getModulePaths(entry)
    const indexPath = path.join(pkgBase, 'index.ts')
    const metadata = parseModuleMetadata(indexPath)

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

  const { pkgBase, appBase } = resolver.getModulePaths(entry)

  if (!fs.existsSync(pkgBase)) {
    throw new Error(
      `Package source directory not found: ${pkgBase}. ` +
      `Make sure the package is installed.`,
    )
  }

  const indexPath = path.join(pkgBase, 'index.ts')
  const metadata = parseModuleMetadata(indexPath)

  if (!metadata.ejectable) {
    throw new Error(
      `Module "${moduleId}" is not marked as ejectable. ` +
      `Only modules with \`ejectable: true\` in their metadata can be ejected.`,
    )
  }

  if (fs.existsSync(appBase)) {
    throw new Error(
      `Destination directory already exists: ${appBase}. ` +
      `Remove it first or resolve the conflict manually.`,
    )
  }

  copyDirRecursive(pkgBase, appBase)

  const modulesPath = resolver.getModulesConfigPath()
  updateModulesTs(modulesPath, moduleId)
}
