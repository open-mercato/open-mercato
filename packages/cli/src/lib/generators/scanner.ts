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

export const MODULE_CODE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'] as const

export function stripModuleCodeExtension(name: string): string {
  for (const extension of MODULE_CODE_EXTENSIONS) {
    if (name.endsWith(extension)) {
      return name.slice(0, -extension.length)
    }
  }
  return name
}

export function isModulePageFile(name: string): boolean {
  return stripModuleCodeExtension(name) === 'page'
}

export function isModuleRouteFile(name: string): boolean {
  return stripModuleCodeExtension(name) === 'route'
}

function resolveCodeFileCandidates(relativePath: string): string[] {
  const candidates = new Set<string>([relativePath])
  const stripped = stripModuleCodeExtension(relativePath)
  if (stripped !== relativePath) {
    for (const extension of MODULE_CODE_EXTENSIONS) {
      candidates.add(`${stripped}${extension}`)
    }
  } else {
    for (const extension of MODULE_CODE_EXTENSIONS) {
      candidates.add(`${relativePath}${extension}`)
    }
  }
  return Array.from(candidates)
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

export function resolveStandaloneSourceMirrorBase(pkgBase: string): string | null {
  const distModulesMarker = `${path.sep}dist${path.sep}modules${path.sep}`
  const markerIndex = pkgBase.lastIndexOf(distModulesMarker)
  if (markerIndex < 0) return null

  const suffix = pkgBase.slice(markerIndex + distModulesMarker.length)
  const sourceBase = `${pkgBase.slice(0, markerIndex)}${path.sep}src${path.sep}modules${path.sep}${suffix}`
  return fs.existsSync(sourceBase) ? sourceBase : null
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

const isTestFile = (name: string) => /\.(test|spec)\.[jt]sx?$/.test(name)
const isScriptFile = (name: string) => ['.ts', '.js'].some((extension) => name.endsWith(extension)) && !isTestFile(name)
const isComponentFile = (name: string) => ['.tsx', '.jsx', '.js'].some((extension) => name.endsWith(extension))
const isMetadataCompanionFile = (name: string) => {
  const stripped = stripModuleCodeExtension(name)
  return stripped === 'meta' || stripped.endsWith('.meta')
}
const isPageCandidateFile = (name: string) =>
  !isMetadataCompanionFile(name)
  && (isModulePageFile(name) || (isComponentFile(name) && !/^[A-Z]/.test(stripModuleCodeExtension(name))))
const isWidgetFile = (name: string) => /^widget\.(t|j)sx?$/.test(name)
const methodNames = new Set(['get', 'post', 'put', 'patch', 'delete'])

export const SCAN_CONFIGS = {
  frontendPages: {
    folder: 'frontend',
    include: isPageCandidateFile,
    sort: staticBeforeDynamicSort,
  },
  backendPages: {
    folder: 'backend',
    include: isPageCandidateFile,
    sort: staticBeforeDynamicSort,
  },
  apiRoutes: {
    folder: 'api',
    include: isModuleRouteFile,
    sort: apiRouteSort,
  },
  apiPlainFiles: {
    folder: 'api',
    include: (name: string) => isScriptFile(name) && !isModuleRouteFile(name),
    skipDirs: (name: string) => methodNames.has(name.toLowerCase()),
  },
  subscribers: {
    folder: 'subscribers',
    include: isScriptFile,
  },
  workers: {
    folder: 'workers',
    include: isScriptFile,
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
  const folderSegments = config.folder ? config.folder.split('/') : []
  const appDir = path.join(roots.appBase, ...folderSegments)
  const pkgScanBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  const pkgDir = path.join(pkgScanBase, ...folderSegments)
  if (!fs.existsSync(appDir) && !fs.existsSync(pkgDir)) return []

  const pkgFiles = fs.existsSync(pkgDir) ? walkDir(pkgDir, config.include, [], config.skipDirs) : []
  const appFiles = fs.existsSync(appDir) ? walkDir(appDir, config.include, [], config.skipDirs) : []
  const filesByLogicalPath = new Map<string, ScannedFile>()

  for (const relPath of pkgFiles) {
    filesByLogicalPath.set(stripModuleCodeExtension(relPath), { relPath, fromApp: false })
  }
  for (const relPath of appFiles) {
    filesByLogicalPath.set(stripModuleCodeExtension(relPath), { relPath, fromApp: true })
  }

  const files = Array.from(filesByLogicalPath.values())
  if (config.sort) {
    files.sort((a, b) => config.sort!(a.relPath, b.relPath))
  }

  return files
}

export function resolveModuleFile(
  roots: ModuleRoots,
  imps: ModuleImports,
  relativePath: string
): ResolvedFile | null {
  const relativeCandidates = resolveCodeFileCandidates(relativePath)
  const pkgScanBase = resolveStandaloneSourceMirrorBase(roots.pkgBase) ?? roots.pkgBase
  const appRelativePath = relativeCandidates.find((candidate) =>
    fs.existsSync(path.join(roots.appBase, ...candidate.split('/')))
  )
  const pkgRelativePath = relativeCandidates.find((candidate) =>
    fs.existsSync(path.join(pkgScanBase, ...candidate.split('/')))
  )
  if (!appRelativePath && !pkgRelativePath) return null

  const fromApp = Boolean(appRelativePath)
  const scanRelativePath = appRelativePath ?? pkgRelativePath!
  let runtimeRelativePath = scanRelativePath

  if (!fromApp && pkgScanBase !== roots.pkgBase) {
    const runtimeCandidates = resolveCodeFileCandidates(stripModuleCodeExtension(scanRelativePath))
    const distRelativePath = runtimeCandidates.find((candidate) =>
      fs.existsSync(path.join(roots.pkgBase, ...candidate.split('/')))
    )
    if (!distRelativePath) {
      return null
    }
    runtimeRelativePath = distRelativePath
  }

  const absoluteBase = fromApp ? roots.appBase : roots.pkgBase
  const absolutePath = path.join(absoluteBase, ...runtimeRelativePath.split('/'))
  const importSuffix = stripModuleCodeExtension(runtimeRelativePath)
  const importPath = `${fromApp ? imps.appBase : imps.pkgBase}/${importSuffix}`
  return { absolutePath, fromApp, importPath }
}

export function resolveFirstModuleFile(
  roots: ModuleRoots,
  imps: ModuleImports,
  relativePaths: string[],
): ResolvedFile | null {
  for (const relativePath of relativePaths) {
    const resolved = resolveModuleFile(roots, imps, relativePath)
    if (resolved) return resolved
  }
  return null
}
