import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

export type IntegrationSpecDiscoveryItem = {
  path: string
  moduleName: string | null
  isOverlay: boolean
  requiredModules: string[]
}

const MODULE_INTEGRATION_DIRECTORY_NAME = '__integration__'
const DISCOVERY_IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  '.turbo',
  'coverage',
  'test-results',
  '.yarn',
  '.cache',
  'tmp',
  'temp',
  '.claude',
  '.codex',
])
const INTEGRATION_META_FILE_NAMES = ['meta.ts', 'index.ts'] as const
const INTEGRATION_META_DEPENDENCY_KEYS = ['dependsOnModules', 'requiredModules', 'requiresModules'] as const
const DEFAULT_OVERLAY_ROOT = 'packages/enterprise'

export function normalizePath(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

function normalizeModuleId(moduleId: string): string {
  return moduleId.trim().toLowerCase()
}

function isEnterpriseModulesEnabled(): boolean {
  const rawValue = process.env.OM_ENABLE_ENTERPRISE_MODULES?.trim().toLowerCase()
  return rawValue === 'true' || rawValue === '1' || rawValue === 'yes' || rawValue === 'on'
}

function collectNamedDirectories(rootPath: string, directoryName: string): string[] {
  let entries
  try {
    entries = readdirSync(rootPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }

  const collected: string[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (DISCOVERY_IGNORED_DIRS.has(entry.name)) continue
    const absolutePath = path.join(rootPath, entry.name)
    if (entry.name === directoryName) {
      collected.push(absolutePath)
    }
    collected.push(...collectNamedDirectories(absolutePath, directoryName))
  }
  return collected
}

function collectSpecFilesFromDirectory(directoryPath: string): string[] {
  let entries
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }

  const collected: string[] = []
  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      collected.push(...collectSpecFilesFromDirectory(absolutePath))
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
      collected.push(absolutePath)
    }
  }
  return collected
}

function collectDirectDirectoryNames(directoryPath: string): string[] {
  let entries
  try {
    entries = readdirSync(directoryPath, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
}

function resolveEnabledModuleIds(projectRoot: string): Set<string> {
  const enabledModules = new Set<string>()
  const appsRoot = path.join(projectRoot, 'apps')
  const packagesRoot = path.join(projectRoot, 'packages')
  const enterpriseEnabled = isEnterpriseModulesEnabled()

  for (const appName of collectDirectDirectoryNames(appsRoot)) {
    const moduleRoot = path.join(appsRoot, appName, 'src', 'modules')
    for (const moduleName of collectDirectDirectoryNames(moduleRoot)) {
      enabledModules.add(normalizeModuleId(moduleName))
    }
  }
  for (const packageName of collectDirectDirectoryNames(packagesRoot)) {
    if (packageName === 'enterprise' && !enterpriseEnabled) {
      continue
    }
    const moduleRoot = path.join(packagesRoot, packageName, 'src', 'modules')
    for (const moduleName of collectDirectDirectoryNames(moduleRoot)) {
      enabledModules.add(normalizeModuleId(moduleName))
    }
  }
  const createAppTemplateModulesRoot = path.join(projectRoot, 'packages', 'create-app', 'template', 'src', 'modules')
  for (const moduleName of collectDirectDirectoryNames(createAppTemplateModulesRoot)) {
    enabledModules.add(normalizeModuleId(moduleName))
  }

  return enabledModules
}

function extractModuleNameFromIntegrationPath(relativePath: string): string | null {
  const segments = normalizePath(relativePath).split('/')
  const integrationDirectoryIndex = segments.indexOf(MODULE_INTEGRATION_DIRECTORY_NAME)
  if (integrationDirectoryIndex <= 0) {
    return null
  }
  const moduleSegment = segments[integrationDirectoryIndex - 1]
  return moduleSegment && moduleSegment.length > 0 ? moduleSegment : null
}

function resolveOverlayRootPath(): string {
  const configured = process.env.OM_INTEGRATION_OVERLAY_ROOT?.trim()
  if (!configured) {
    return DEFAULT_OVERLAY_ROOT
  }
  return configured.replace(/\/+$/, '')
}

function isOverlayIntegrationPath(relativePath: string, overlayRoot: string): boolean {
  return normalizePath(relativePath).startsWith(`${normalizePath(overlayRoot)}/`)
}

function extractDependencyListFromSource(source: string): string[] {
  const collected = new Set<string>()
  for (const key of INTEGRATION_META_DEPENDENCY_KEYS) {
    const keyPattern = new RegExp(`${key}\\s*:\\s*\\[([\\s\\S]*?)\\]`, 'm')
    const keyMatch = source.match(keyPattern)
    if (!keyMatch?.[1]) continue
    const valuesPattern = /['"`]([a-zA-Z0-9_.-]+)['"`]/g
    for (const valueMatch of keyMatch[1].matchAll(valuesPattern)) {
      const value = normalizeModuleId(valueMatch[1] ?? '')
      if (value) {
        collected.add(value)
      }
    }
  }
  return Array.from(collected)
}

function readDependenciesFromMetadataFile(absolutePath: string): string[] {
  try {
    return extractDependencyListFromSource(readFileSync(absolutePath, 'utf8'))
  } catch {
    return []
  }
}

function resolveIntegrationRootDirectory(relativeSpecPath: string): string | null {
  const segments = normalizePath(relativeSpecPath).split('/')
  const integrationDirectoryIndex = segments.indexOf(MODULE_INTEGRATION_DIRECTORY_NAME)
  if (integrationDirectoryIndex === -1) {
    return null
  }
  return segments.slice(0, integrationDirectoryIndex + 1).join('/')
}

function resolveRequiredModulesForSpec(projectRoot: string, relativeSpecPath: string): string[] {
  const requiredModules = new Set<string>()
  const normalizedSpecPath = normalizePath(relativeSpecPath)
  const absoluteSpecPath = path.join(projectRoot, normalizedSpecPath)
  const integrationRoot = resolveIntegrationRootDirectory(normalizedSpecPath)

  if (integrationRoot) {
    const relativeDirectory = normalizePath(path.dirname(normalizedSpecPath))
    const integrationRootAbsolute = path.join(projectRoot, integrationRoot)
    const directoryAbsolute = path.join(projectRoot, relativeDirectory)
    const relativeFromIntegrationRoot = normalizePath(path.relative(integrationRootAbsolute, directoryAbsolute))
    const pathSegments = relativeFromIntegrationRoot === '.'
      ? []
      : relativeFromIntegrationRoot.split('/').filter(Boolean)

    let currentDirectory = integrationRootAbsolute
    const traversal = [currentDirectory, ...pathSegments.map((segment) => {
      currentDirectory = path.join(currentDirectory, segment)
      return currentDirectory
    })]

    for (const directoryPath of traversal) {
      for (const metadataFileName of INTEGRATION_META_FILE_NAMES) {
        const metadataPath = path.join(directoryPath, metadataFileName)
        readDependenciesFromMetadataFile(metadataPath).forEach((dependency) => requiredModules.add(dependency))
      }
    }
  }

  readDependenciesFromMetadataFile(absoluteSpecPath).forEach((dependency) => requiredModules.add(dependency))
  const specFileName = path.basename(normalizedSpecPath, '.spec.ts')
  const perTestMetadataPath = path.join(path.dirname(absoluteSpecPath), `${specFileName}.meta.ts`)
  readDependenciesFromMetadataFile(perTestMetadataPath).forEach((dependency) => requiredModules.add(dependency))

  return Array.from(requiredModules)
}

export function discoverIntegrationSpecFiles(projectRoot: string, legacyIntegrationRoot: string): IntegrationSpecDiscoveryItem[] {
  const discoveredByPath = new Map<string, IntegrationSpecDiscoveryItem>()
  const overlayRoot = resolveOverlayRootPath()
  const enterpriseEnabled = isEnterpriseModulesEnabled()
  const discoveryRoots = [
    path.join(projectRoot, 'apps'),
    path.join(projectRoot, 'packages'),
  ]

  for (const specFile of collectSpecFilesFromDirectory(legacyIntegrationRoot)) {
    const relativePath = normalizePath(path.relative(projectRoot, specFile))
    discoveredByPath.set(relativePath, {
      path: relativePath,
      moduleName: extractModuleNameFromIntegrationPath(relativePath),
      isOverlay: isOverlayIntegrationPath(relativePath, overlayRoot),
      requiredModules: resolveRequiredModulesForSpec(projectRoot, relativePath),
    })
  }

  for (const root of discoveryRoots) {
    for (const integrationDirectory of collectNamedDirectories(root, MODULE_INTEGRATION_DIRECTORY_NAME)) {
      for (const specFile of collectSpecFilesFromDirectory(integrationDirectory)) {
        const relativePath = normalizePath(path.relative(projectRoot, specFile))
        discoveredByPath.set(relativePath, {
          path: relativePath,
          moduleName: extractModuleNameFromIntegrationPath(relativePath),
          isOverlay: isOverlayIntegrationPath(relativePath, overlayRoot),
          requiredModules: resolveRequiredModulesForSpec(projectRoot, relativePath),
        })
      }
    }
  }

  const discovered = Array.from(discoveredByPath.values())
  const enabledModules = resolveEnabledModuleIds(projectRoot)
  const enabledModuleNames = new Set<string>()
  for (const file of discovered) {
    if (!file.isOverlay && file.moduleName) {
      enabledModuleNames.add(file.moduleName)
    }
  }

  return discovered
    .filter((file) => {
      if (file.requiredModules.some((moduleId) => !enabledModules.has(normalizeModuleId(moduleId)))) {
        return false
      }
      if (!file.isOverlay) {
        return true
      }
      if (!enterpriseEnabled) {
        return false
      }
      if (!file.moduleName) {
        return true
      }
      if (enabledModuleNames.has(file.moduleName)) {
        return true
      }
      return enabledModules.has(normalizeModuleId(file.moduleName))
    })
    .sort((left, right) => left.path.localeCompare(right.path))
}
