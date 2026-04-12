import { createRequire } from 'node:module'
import type { PackageResolver } from '../resolver'
import { resolveModuleFile } from '../generators/scanner'
import { createStaticModuleReader } from './source-analysis'

const requireModule = createRequire(import.meta.url)

export interface UmesExtensionEntry {
  moduleId: string
  type: 'enricher' | 'interceptor' | 'component-override' | 'injection-widget'
  id: string
  target: string
  priority: number
  features?: string[]
  details?: Record<string, unknown>
}

export interface UmesModuleData {
  moduleId: string
  extensions: UmesExtensionEntry[]
  declaredFeatures: string[]
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items = value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
  return items.length > 0 ? items : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readExportValue(options: {
  exportNames: string[]
  resolvedFile: { absolutePath: string }
}) {
  const { exportNames, resolvedFile } = options
  const loadedModule = requireModule(resolvedFile.absolutePath)
  for (const exportName of exportNames) {
    const value = exportName === 'default'
      ? loadedModule.default
      : loadedModule[exportName]
    if (value !== undefined) return value
  }
  return undefined
}

export function collectUmesData(resolver: PackageResolver): UmesModuleData[] {
  const enabled = resolver.loadEnabledModules()
  const results: UmesModuleData[] = []
  const sourceReader = createStaticModuleReader()

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)
    const imps = resolver.getModuleImportBase(entry)
    const isAppModule = entry.from === '@app'
    const appImportBase = isAppModule ? `../../src/modules/${modId}` : imps.appBase
    const moduleImps = { appBase: appImportBase, pkgBase: imps.pkgBase }
    const fromSource = resolver.isMonorepo() || entry.from === '@app'

    const extensions: UmesExtensionEntry[] = []
    const declaredFeatures: string[] = []

    // Collect features from acl.ts
    const aclFile = resolveModuleFile(roots, moduleImps, 'acl.ts')
    if (aclFile) {
      try {
        const features = fromSource
          ? sourceReader.readExport(aclFile.absolutePath, ['features', 'default']) ?? []
          : readExportValue({ exportNames: ['features', 'default'], resolvedFile: aclFile }) ?? []
        if (Array.isArray(features)) {
          for (const feat of features) {
            if (typeof feat === 'string') {
              declaredFeatures.push(feat)
              continue
            }
            const featureRecord = readRecord(feat)
            const featureId = readString(featureRecord?.id)
            if (featureId) declaredFeatures.push(featureId)
          }
        }
      } catch {}
    }

    // Collect enrichers
    const enrichersFile = resolveModuleFile(roots, moduleImps, 'data/enrichers.ts')
    if (enrichersFile) {
      try {
        const enrichers = fromSource
          ? sourceReader.readExport(enrichersFile.absolutePath, ['enrichers', 'default']) ?? []
          : readExportValue({ exportNames: ['enrichers', 'default'], resolvedFile: enrichersFile }) ?? []
        if (Array.isArray(enrichers)) {
          for (const enricher of enrichers) {
            const enricherRecord = readRecord(enricher)
            const enricherId = readString(enricherRecord?.id)
            if (enricherId) {
              extensions.push({
                moduleId: modId,
                type: 'enricher',
                id: enricherId,
                target: readString(enricherRecord?.targetEntity) ?? '*',
                priority: readNumber(enricherRecord?.priority) ?? 0,
                features: readStringArray(enricherRecord?.features),
                details: {
                  timeout: readNumber(enricherRecord?.timeout),
                  critical: typeof enricherRecord?.critical === 'boolean' ? enricherRecord.critical : undefined,
                  hasCache: Boolean(enricherRecord?.cache),
                  hasQueryEngine: Boolean(enricherRecord?.queryEngine),
                },
              })
            }
          }
        }
      } catch {}
    }

    // Collect interceptors
    const interceptorsFile = resolveModuleFile(roots, moduleImps, 'api/interceptors.ts')
    if (interceptorsFile) {
      try {
        const interceptors = fromSource
          ? sourceReader.readExport(interceptorsFile.absolutePath, ['interceptors', 'default']) ?? []
          : readExportValue({ exportNames: ['interceptors', 'default'], resolvedFile: interceptorsFile }) ?? []
        if (Array.isArray(interceptors)) {
          for (const interceptor of interceptors) {
            const interceptorRecord = readRecord(interceptor)
            const interceptorId = readString(interceptorRecord?.id)
            const targetRoute = readString(interceptorRecord?.targetRoute)
            const methods = readStringArray(interceptorRecord?.methods) ?? []
            if (interceptorId && targetRoute) {
              extensions.push({
                moduleId: modId,
                type: 'interceptor',
                id: interceptorId,
                target: `${methods.join(',')} ${targetRoute}`,
                priority: readNumber(interceptorRecord?.priority) ?? 0,
                features: readStringArray(interceptorRecord?.features),
                details: {
                  targetRoute,
                  methods,
                  hasBefore: Boolean(interceptorRecord?.before),
                  hasAfter: Boolean(interceptorRecord?.after),
                },
              })
            }
          }
        }
      } catch {}
    }

    // Collect component overrides
    const componentsFile = resolveModuleFile(roots, moduleImps, 'widgets/components.ts')
    if (componentsFile) {
      try {
        const overrides = fromSource
          ? sourceReader.readExport(componentsFile.absolutePath, ['componentOverrides', 'default']) ?? []
          : readExportValue({ exportNames: ['componentOverrides', 'default'], resolvedFile: componentsFile }) ?? []
        if (Array.isArray(overrides)) {
          for (const override of overrides) {
            const overrideRecord = readRecord(override)
            const componentId = readString(readRecord(overrideRecord?.target)?.componentId)
            if (componentId) {
              const kind = overrideRecord?.replacement
                ? 'replacement'
                : overrideRecord?.wrapper
                  ? 'wrapper'
                  : 'propsTransform'
              extensions.push({
                moduleId: modId,
                type: 'component-override',
                id: `${modId}.${componentId}`,
                target: componentId,
                priority: readNumber(overrideRecord?.priority) ?? 0,
                features: readStringArray(overrideRecord?.features),
                details: { overrideKind: kind },
              })
            }
          }
        }
      } catch {}
    }

    // Collect injection table entries
    const injectionTableFile = resolveModuleFile(roots, moduleImps, 'widgets/injection-table.ts')
    if (injectionTableFile) {
      try {
        const table = fromSource
          ? sourceReader.readExport(injectionTableFile.absolutePath, ['injectionTable', 'default']) ?? {}
          : readExportValue({ exportNames: ['injectionTable', 'default'], resolvedFile: injectionTableFile }) ?? {}
        for (const [spotId, value] of Object.entries(table)) {
          const entries = Array.isArray(value) ? value : [value]
          for (const entry of entries) {
            const entryRecord = readRecord(entry)
            const widgetId = typeof entry === 'string' ? entry : readString(entryRecord?.widgetId)
            const priority = readNumber(entryRecord?.priority) ?? 0
            if (widgetId) {
              extensions.push({
                moduleId: modId,
                type: 'injection-widget',
                id: widgetId,
                target: spotId,
                priority,
              })
            }
          }
        }
      } catch {}
    }

    results.push({ moduleId: modId, extensions, declaredFeatures })
  }

  return results
}
