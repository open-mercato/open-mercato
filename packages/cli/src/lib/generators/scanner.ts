import fs from 'node:fs'
import path from 'node:path'

export type ScannedFile = {
  relPath: string
  fromApp: boolean
}

export type ScanConfig = {
  folder: string
  include: (name: string) => boolean
  skipDirs?: (name: string) => boolean
  sort?: (a: string, b: string) => number
}

export type ModuleRoots = {
  appBase: string
  pkgBase: string
}

export type ModuleImports = {
  appBase: string
  pkgBase: string
}

export type ResolvedFile = {
  absolutePath: string
  fromApp: boolean
  importPath: string
}

function walkDir(
  dir: string,
  include: (name: string) => boolean,
  rel: string[] = [],
  skipDirs?: (name: string) => boolean
): string[] {
  const found: string[] = []
  if (!fs.existsSync(dir)) return found
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue
      if (skipDirs && skipDirs(entry.name)) continue
      found.push(...walkDir(path.join(dir, entry.name), include, [...rel, entry.name], skipDirs))
    } else if (entry.isFile() && include(entry.name)) {
      found.push([...rel, entry.name].join('/'))
    }
  }
  return found
}

const isDynamic = (p: string) => /\/(\[|\[\[\.\.\.)/.test(p) || /^\[/.test(p)

function staticBeforeDynamicSort(a: string, b: string): number {
  const ad = isDynamic(a) ? 1 : 0
  const bd = isDynamic(b) ? 1 : 0
  if (ad !== bd) return ad - bd
  return a.localeCompare(b)
}

function isDynamicRoute(p: string): boolean {
  return p.split('/').some((seg) => /\[|\[\[\.\.\./.test(seg))
}

function apiRouteSort(a: string, b: string): number {
  const ad = isDynamicRoute(a) ? 1 : 0
  const bd = isDynamicRoute(b) ? 1 : 0
  if (ad !== bd) return ad - bd
  return a.localeCompare(b)
}

const isTestFile = (name: string) => /\.(test|spec)\.ts$/.test(name)
const isTsFile = (name: string) => name.endsWith('.ts') && !isTestFile(name)
const isTsxFile = (name: string) => name.endsWith('.tsx')
const isRouteTs = (name: string) => name === 'route.ts'
const isWidgetFile = (name: string) => /^widget\.(t|j)sx?$/.test(name)
const methodNames = new Set(['get', 'post', 'put', 'patch', 'delete'])

export const SCAN_CONFIGS = {
  frontendPages: {
    folder: 'frontend',
    include: isTsxFile,
    sort: staticBeforeDynamicSort,
  },
  backendPages: {
    folder: 'backend',
    include: isTsxFile,
    sort: staticBeforeDynamicSort,
  },
  apiRoutes: {
    folder: 'api',
    include: isRouteTs,
    sort: apiRouteSort,
  },
  apiPlainFiles: {
    folder: 'api',
    include: (name: string) => name.endsWith('.ts') && name !== 'route.ts' && !isTestFile(name),
    skipDirs: (name: string) => methodNames.has(name.toLowerCase()),
  },
  subscribers: {
    folder: 'subscribers',
    include: isTsFile,
  },
  workers: {
    folder: 'workers',
    include: isTsFile,
  },
  dashboardWidgets: {
    folder: 'widgets/dashboard',
    include: isWidgetFile,
    sort: (a: string, b: string) => a.localeCompare(b),
  },
  injectionWidgets: {
    folder: 'widgets/injection',
    include: isWidgetFile,
    sort: (a: string, b: string) => a.localeCompare(b),
  },
} as const satisfies Record<string, ScanConfig>

export function scanModuleDir(roots: ModuleRoots, config: ScanConfig): ScannedFile[] {
  const appDir = path.join(roots.appBase, ...config.folder.split('/'))
  const pkgDir = path.join(roots.pkgBase, ...config.folder.split('/'))
  if (!fs.existsSync(appDir) && !fs.existsSync(pkgDir)) return []

  const found: string[] = []
  if (fs.existsSync(pkgDir)) found.push(...walkDir(pkgDir, config.include, [], config.skipDirs))
  if (fs.existsSync(appDir)) found.push(...walkDir(appDir, config.include, [], config.skipDirs))

  let files = Array.from(new Set(found))
  if (config.sort) {
    files.sort(config.sort)
  }

  return files.map((relPath) => {
    const appFile = path.join(appDir, ...relPath.split('/'))
    const fromApp = fs.existsSync(appFile)
    return { relPath, fromApp }
  })
}

export function resolveModuleFile(
  roots: ModuleRoots,
  imps: ModuleImports,
  relativePath: string
): ResolvedFile | null {
  const segments = relativePath.split('/')
  const appFile = path.join(roots.appBase, ...segments)
  const pkgFile = path.join(roots.pkgBase, ...segments)
  const hasApp = fs.existsSync(appFile)
  const hasPkg = fs.existsSync(pkgFile)
  if (!hasApp && !hasPkg) return null

  const fromApp = hasApp
  const absolutePath = fromApp ? appFile : pkgFile
  const importSuffix = relativePath.replace(/\.ts$/, '')
  const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/${importSuffix}`
  return { absolutePath, fromApp, importPath }
}
