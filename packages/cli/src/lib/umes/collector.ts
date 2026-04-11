import path from 'node:path'
import { createRequire } from 'node:module'
import type { PackageResolver } from '../resolver'
import { resolveModuleFile } from '../generators/scanner'

const requireModule = createRequire(path.join(process.cwd(), 'package.json'))

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

export function collectUmesData(resolver: PackageResolver): UmesModuleData[] {
  const enabled = resolver.loadEnabledModules()
  const results: UmesModuleData[] = []

  for (const entry of enabled) {
    const modId = entry.id
    const roots = resolver.getModulePaths(entry)
    const imps = resolver.getModuleImportBase(entry)
    const isAppModule = entry.from === '@app'
    const appImportBase = isAppModule ? `../../src/modules/${modId}` : imps.appBase
    const moduleImps = { appBase: appImportBase, pkgBase: imps.pkgBase }

    const extensions: UmesExtensionEntry[] = []
    const declaredFeatures: string[] = []

    // Collect features from acl.ts
    const aclFile = resolveModuleFile(roots, moduleImps, 'acl.ts')
    if (aclFile) {
      try {
        const aclMod = requireModule(aclFile.absolutePath)
        const features = aclMod.features ?? aclMod.default ?? []
        if (Array.isArray(features)) {
          for (const feat of features) {
            if (typeof feat === 'string') declaredFeatures.push(feat)
            else if (feat?.id) declaredFeatures.push(feat.id)
          }
        }
      } catch (err) {
        console.warn(`[UMES] Failed to load acl.ts for module "${modId}":`, err)
      }
    }

    // Collect enrichers
    const enrichersFile = resolveModuleFile(roots, moduleImps, 'data/enrichers.ts')
    if (enrichersFile) {
      try {
        const enrichersMod = requireModule(enrichersFile.absolutePath)
        const enrichers = enrichersMod.enrichers ?? enrichersMod.default ?? []
        if (Array.isArray(enrichers)) {
          for (const enricher of enrichers) {
            if (enricher?.id) {
              extensions.push({
                moduleId: modId,
                type: 'enricher',
                id: enricher.id,
                target: enricher.targetEntity ?? '*',
                priority: enricher.priority ?? 0,
                features: enricher.features,
                details: {
                  timeout: enricher.timeout,
                  critical: enricher.critical,
                  hasCache: !!enricher.cache,
                  hasQueryEngine: !!enricher.queryEngine,
                },
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[UMES] Failed to load data/enrichers.ts for module "${modId}":`, err)
      }
    }

    // Collect interceptors
    const interceptorsFile = resolveModuleFile(roots, moduleImps, 'api/interceptors.ts')
    if (interceptorsFile) {
      try {
        const interceptorsMod = requireModule(interceptorsFile.absolutePath)
        const interceptors = interceptorsMod.interceptors ?? interceptorsMod.default ?? []
        if (Array.isArray(interceptors)) {
          for (const interceptor of interceptors) {
            if (interceptor?.id) {
              extensions.push({
                moduleId: modId,
                type: 'interceptor',
                id: interceptor.id,
                target: `${(interceptor.methods ?? []).join(',')} ${interceptor.targetRoute}`,
                priority: interceptor.priority ?? 0,
                features: interceptor.features,
                details: {
                  targetRoute: interceptor.targetRoute,
                  methods: interceptor.methods,
                  hasBefore: !!interceptor.before,
                  hasAfter: !!interceptor.after,
                },
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[UMES] Failed to load api/interceptors.ts for module "${modId}":`, err)
      }
    }

    // Collect component overrides
    const componentsFile = resolveModuleFile(roots, moduleImps, 'widgets/components.ts')
    if (componentsFile) {
      try {
        const componentsMod = requireModule(componentsFile.absolutePath)
        const overrides = componentsMod.componentOverrides ?? componentsMod.default ?? []
        if (Array.isArray(overrides)) {
          for (const override of overrides) {
            const componentId = override?.target?.componentId
            if (componentId) {
              const kind = override.replacement ? 'replacement' : override.wrapper ? 'wrapper' : 'propsTransform'
              extensions.push({
                moduleId: modId,
                type: 'component-override',
                id: `${modId}.${componentId}`,
                target: componentId,
                priority: override.priority ?? 0,
                features: override.features,
                details: { overrideKind: kind },
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[UMES] Failed to load widgets/components.ts for module "${modId}":`, err)
      }
    }

    // Collect injection table entries
    const injectionTableFile = resolveModuleFile(roots, moduleImps, 'widgets/injection-table.ts')
    if (injectionTableFile) {
      try {
        const tableMod = requireModule(injectionTableFile.absolutePath)
        const table = tableMod.injectionTable ?? tableMod.default ?? {}
        for (const [spotId, value] of Object.entries(table)) {
          const entries = Array.isArray(value) ? value : [value]
          for (const entry of entries) {
            const widgetId = typeof entry === 'string' ? entry : (entry as Record<string, unknown>)?.widgetId
            const priority = typeof entry === 'object' ? ((entry as Record<string, unknown>)?.priority as number) ?? 0 : 0
            if (widgetId) {
              extensions.push({
                moduleId: modId,
                type: 'injection-widget',
                id: widgetId as string,
                target: spotId,
                priority,
              })
            }
          }
        }
      } catch (err) {
        console.warn(`[UMES] Failed to load widgets/injection-table.ts for module "${modId}":`, err)
      }
    }

    results.push({ moduleId: modId, extensions, declaredFeatures })
  }

  return results
}
