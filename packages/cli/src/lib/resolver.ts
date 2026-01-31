import path from 'node:path'
import fs from 'node:fs'

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
  getAppDir(): string
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
    // Packages ship with src/ included, so we can read TypeScript source files
    const pkgName = from || '@open-mercato/core'
    return path.join(rootDir, 'node_modules', pkgName, 'src', 'modules')
  }

  // Monorepo mode - read from src/modules (TypeScript source)
  if (!from || from === '@open-mercato/core') {
    return path.resolve(rootDir, 'packages/core/src/modules')
  }
  // Support other local packages like '@open-mercato/onboarding' => packages/onboarding/src/modules
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

function parseModulesFromSource(source: string): ModuleEntry[] {
  // Parse the enabledModules array from TypeScript source
  // This is more reliable than trying to require() a .ts file
  const match = source.match(/export\s+const\s+enabledModules[^=]*=\s*\[([\s\S]*?)\]/)
  if (!match) return []

  const arrayContent = match[1]
  const modules: ModuleEntry[] = []

  // Match each object in the array: { id: '...', from: '...' }
  const objectRegex = /\{\s*id:\s*['"]([^'"]+)['"]\s*(?:,\s*from:\s*['"]([^'"]+)['"])?\s*\}/g
  let objMatch
  while ((objMatch = objectRegex.exec(arrayContent)) !== null) {
    const [, id, from] = objMatch
    modules.push({ id, from: from || '@open-mercato/core' })
  }

  return modules
}

function loadEnabledModulesFromConfig(appDir: string): ModuleEntry[] {
  const cfgPath = path.resolve(appDir, 'src/modules.ts')
  if (fs.existsSync(cfgPath)) {
    try {
      const source = fs.readFileSync(cfgPath, 'utf8')
      const list = parseModulesFromSource(source)
      if (list.length) return list
    } catch {
      // Fall through to fallback
    }
  }
  // Fallback: scan src/modules/* to keep backward compatibility
  const modulesRoot = path.resolve(appDir, 'src/modules')
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
      // Read from src/modules (TypeScript source)
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
      // Packages ship with src/ included, so we can read TypeScript source files
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

function detectAppDir(rootDir: string, isMonorepo: boolean): string {
  if (!isMonorepo) {
    // Production mode: app is at root
    return rootDir
  }

  // Monorepo mode: look for app in apps/mercato/ or apps/app/
  const mercatoApp = path.join(rootDir, 'apps', 'mercato')
  if (fs.existsSync(mercatoApp)) {
    return mercatoApp
  }

  const defaultApp = path.join(rootDir, 'apps', 'app')
  if (fs.existsSync(defaultApp)) {
    return defaultApp
  }

  // Fallback: check if apps directory exists and has any app
  const appsDir = path.join(rootDir, 'apps')
  if (fs.existsSync(appsDir)) {
    const entries = fs.readdirSync(appsDir, { withFileTypes: true })
    const appEntry = entries.find(
      (e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'docs'
    )
    if (appEntry) {
      return path.join(appsDir, appEntry.name)
    }
  }

  // Final fallback for legacy structure: root is the app
  return rootDir
}

function findNodeModulesRoot(startDir: string): string | null {
  // Walk up to find node_modules/@open-mercato/core
  let dir = startDir
  while (dir !== path.dirname(dir)) {
    const corePkgPath = path.join(dir, 'node_modules', '@open-mercato', 'core')
    if (fs.existsSync(corePkgPath)) {
      return dir
    }
    dir = path.dirname(dir)
  }
  return null
}

function detectMonorepoFromNodeModules(appDir: string): { isMonorepo: boolean; monorepoRoot: string | null; nodeModulesRoot: string | null } {
  // Find where node_modules/@open-mercato/core is located (may be hoisted)
  const nodeModulesRoot = findNodeModulesRoot(appDir)
  if (!nodeModulesRoot) {
    return { isMonorepo: false, monorepoRoot: null, nodeModulesRoot: null }
  }

  const corePkgPath = path.join(nodeModulesRoot, 'node_modules', '@open-mercato', 'core')

  try {
    const stat = fs.lstatSync(corePkgPath)
    if (stat.isSymbolicLink()) {
      // It's a symlink - we're in monorepo dev mode
      // Resolve the symlink to find the monorepo root
      const realPath = fs.realpathSync(corePkgPath)
      // realPath is something like /path/to/monorepo/packages/core
      // monorepo root is 2 levels up
      const monorepoRoot = path.dirname(path.dirname(realPath))
      return { isMonorepo: true, monorepoRoot, nodeModulesRoot }
    }
    // It's a real directory - production mode
    return { isMonorepo: false, monorepoRoot: null, nodeModulesRoot }
  } catch {
    // Package doesn't exist yet or error reading - assume production mode
    return { isMonorepo: false, monorepoRoot: null, nodeModulesRoot }
  }
}

export function createResolver(cwd: string = process.cwd()): PackageResolver {
  // First detect if we're in a monorepo by checking if node_modules packages are symlinks
  const { isMonorepo: _isMonorepo, monorepoRoot } = detectMonorepoFromNodeModules(cwd)
  const rootDir = monorepoRoot ?? cwd

  // The app directory depends on context:
  // - In monorepo: use detectAppDir to find apps/mercato or similar
  // - In production: app is at cwd
  const appDir = _isMonorepo ? detectAppDir(rootDir, true) : cwd

  return {
    isMonorepo: () => _isMonorepo,

    getRootDir: () => rootDir,

    getAppDir: () => appDir,

    getOutputDir: () => {
      // Output is ALWAYS .mercato/generated relative to app directory
      return path.join(appDir, '.mercato', 'generated')
    },

    getModulesConfigPath: () => path.join(appDir, 'src', 'modules.ts'),

    discoverPackages: () => {
      return _isMonorepo
        ? discoverPackagesInMonorepo(rootDir)
        : discoverPackagesInNodeModules(rootDir)
    },

    loadEnabledModules: () => loadEnabledModulesFromConfig(appDir),

    getModulePaths: (entry: ModuleEntry) => {
      const appBase = path.resolve(appDir, 'src/modules', entry.id)
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
        // App output goes to .mercato/generated
        return path.join(appDir, '.mercato', 'generated')
      }
      const pkgRoot = pkgRootFor(rootDir, packageName, _isMonorepo)
      return path.join(pkgRoot, 'generated')
    },

    getPackageRoot: (from?: string) => {
      return pkgRootFor(rootDir, from, _isMonorepo)
    },
  }
}
