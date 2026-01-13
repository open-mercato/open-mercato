import path from 'node:path'
import fs from 'node:fs'
import { createRequire } from 'node:module'

export type ModuleEntry = {
  id: string
  from?: '@open-mercato/core' | '@app' | string
}

export type PackageInfo = {
  name: string
  path: string
  modulesPath: string
}

export interface PackageResolver {
  isMonorepo(): boolean
  getRootDir(): string
  getOutputDir(): string
  getModulesConfigPath(): string
  discoverPackages(): PackageInfo[]
  loadEnabledModules(): ModuleEntry[]
  getModulePaths(entry: ModuleEntry): { appBase: string; pkgBase: string }
  getModuleImportBase(entry: ModuleEntry): { appBase: string; pkgBase: string }
  getPackageOutputDir(packageName: string): string
  getPackageRoot(from?: string): string
}

function pkgDirFor(rootDir: string, from?: string, isMonorepo = true): string {
  if (!isMonorepo) {
    // Production mode: look in node_modules
    const pkgName = from || '@open-mercato/core'
    return path.join(rootDir, 'node_modules', pkgName, 'dist', 'modules')
  }

  // Monorepo mode
  if (!from || from === '@open-mercato/core') {
    return path.resolve(rootDir, 'packages/core/src/modules')
  }
  // Support other local packages like '@open-mercato/example' => packages/example/src/modules
  const m = from.match(/^@open-mercato\/(.+)$/)
  if (m) {
    return path.resolve(rootDir, `packages/${m[1]}/src/modules`)
  }
  // Fallback to core modules path
  return path.resolve(rootDir, 'packages/core/src/modules')
}

function pkgRootFor(rootDir: string, from?: string, isMonorepo = true): string {
  if (!isMonorepo) {
    const pkgName = from || '@open-mercato/core'
    return path.join(rootDir, 'node_modules', pkgName)
  }

  if (!from || from === '@open-mercato/core') {
    return path.resolve(rootDir, 'packages/core')
  }
  const m = from.match(/^@open-mercato\/(.+)$/)
  if (m) {
    return path.resolve(rootDir, `packages/${m[1]}`)
  }
  return path.resolve(rootDir, 'packages/core')
}

function loadEnabledModulesFromConfig(rootDir: string): ModuleEntry[] {
  const require = createRequire(import.meta.url)
  const cfgPath = path.resolve(rootDir, 'src/modules.ts')
  if (fs.existsSync(cfgPath)) {
    try {
      const mod = require(cfgPath)
      const list = (mod.enabledModules || mod.default || []) as ModuleEntry[]
      if (Array.isArray(list) && list.length) return list
    } catch {
      // Fall through to fallback
    }
  }
  // Fallback: scan src/modules/* to keep backward compatibility
  const modulesRoot = path.resolve(rootDir, 'src/modules')
  if (!fs.existsSync(modulesRoot)) return []
  return fs
    .readdirSync(modulesRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => ({ id: e.name, from: '@app' as const }))
}

function discoverPackagesInMonorepo(rootDir: string): PackageInfo[] {
  const packagesDir = path.join(rootDir, 'packages')
  if (!fs.existsSync(packagesDir)) return []

  const packages: PackageInfo[] = []
  const entries = fs.readdirSync(packagesDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgPath = path.join(packagesDir, entry.name)
    const pkgJsonPath = path.join(pkgPath, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) continue

    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
      const modulesPath = path.join(pkgPath, 'src', 'modules')

      if (fs.existsSync(modulesPath)) {
        packages.push({
          name: pkgJson.name || `@open-mercato/${entry.name}`,
          path: pkgPath,
          modulesPath,
        })
      }
    } catch {
      // Skip invalid packages
    }
  }

  return packages
}

function discoverPackagesInNodeModules(rootDir: string): PackageInfo[] {
  const nodeModulesPath = path.join(rootDir, 'node_modules', '@open-mercato')
  if (!fs.existsSync(nodeModulesPath)) return []

  const packages: PackageInfo[] = []
  const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const pkgPath = path.join(nodeModulesPath, entry.name)
    const pkgJsonPath = path.join(pkgPath, 'package.json')

    if (!fs.existsSync(pkgJsonPath)) continue

    try {
      const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
      const modulesPath = path.join(pkgPath, 'dist', 'modules')

      if (fs.existsSync(modulesPath)) {
        packages.push({
          name: pkgJson.name || `@open-mercato/${entry.name}`,
          path: pkgPath,
          modulesPath,
        })
      }
    } catch {
      // Skip invalid packages
    }
  }

  return packages
}

export function createResolver(cwd: string = process.cwd()): PackageResolver {
  const rootDir = cwd
  const packagesDir = path.join(rootDir, 'packages')
  const _isMonorepo = fs.existsSync(packagesDir)

  return {
    isMonorepo: () => _isMonorepo,

    getRootDir: () => rootDir,

    getOutputDir: () => {
      return _isMonorepo
        ? path.join(rootDir, 'generated')
        : path.join(rootDir, '.mercato', 'generated')
    },

    getModulesConfigPath: () => path.join(rootDir, 'src', 'modules.ts'),

    discoverPackages: () => {
      return _isMonorepo
        ? discoverPackagesInMonorepo(rootDir)
        : discoverPackagesInNodeModules(rootDir)
    },

    loadEnabledModules: () => loadEnabledModulesFromConfig(rootDir),

    getModulePaths: (entry: ModuleEntry) => {
      const appBase = path.resolve(rootDir, 'src/modules', entry.id)
      const pkgModulesRoot = pkgDirFor(rootDir, entry.from, _isMonorepo)
      const pkgBase = path.join(pkgModulesRoot, entry.id)
      return { appBase, pkgBase }
    },

    getModuleImportBase: (entry: ModuleEntry) => {
      // Prefer @app overrides at import-time; fall back to provided package alias
      const from = entry.from || '@open-mercato/core'
      return {
        appBase: `@/modules/${entry.id}`,
        pkgBase: `${from}/modules/${entry.id}`,
      }
    },

    getPackageOutputDir: (packageName: string) => {
      if (packageName === '@app') {
        return path.join(rootDir, 'generated')
      }
      const pkgRoot = pkgRootFor(rootDir, packageName, _isMonorepo)
      return path.join(pkgRoot, 'generated')
    },

    getPackageRoot: (from?: string) => {
      return pkgRootFor(rootDir, from, _isMonorepo)
    },
  }
}
