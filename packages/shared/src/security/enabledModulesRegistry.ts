/**
 * Module-aware grant filtering.
 *
 * Features live under `<module>.<action>` (see AGENTS.md naming convention).
 * When a module is disabled in `modules.ts`, its routes/UI are absent but
 * roles may still carry the feature string. Anywhere we turn raw ACL
 * grants into "what the user can currently act on", we must drop grants
 * whose owning module is not enabled — otherwise stale grants re-open the
 * 404-class bug PR #1567 only partially fixed.
 *
 * Owning-module resolution:
 * - Most features follow the convention so `id.split('.')[0]` matches the
 *   module id. For those, the prefix is correct.
 * - A few features (e.g. `analytics.view`) deliberately use a different
 *   namespace from their owning module. For those, the registry's declared
 *   `module` field on the `Module.features` entry is authoritative. We
 *   consult it first and fall back to the prefix only when the feature is
 *   unknown to the registry.
 *
 * This helper is server-only: it reads the enabled module set from the
 * bootstrapped module registry. The browser never imports it; instead,
 * server code pre-filters `BackendChromePayload.grantedFeatures` so
 * client-side `hasFeature` can stay a pure grant check.
 */

import { getModules } from '../lib/modules/registry'
import type { Module } from '../modules/registry'

type FeatureRegistry = {
  enabledModuleIds: string[]
  enabledModuleSet: Set<string>
  featureToModule: Map<string, string>
  prefixToModule: Map<string, string>
}

let cachedRegistry: FeatureRegistry | null = null
let cachedModulesRef: readonly Module[] | null = null

function buildRegistry(modules: readonly Module[]): FeatureRegistry {
  const enabledModuleIds = modules.map((mod) => mod.id)
  const enabledModuleSet = new Set(enabledModuleIds)
  const featureToModule = new Map<string, string>()
  const prefixToModule = new Map<string, string>()
  for (const mod of modules) {
    const features = mod.features
    if (!Array.isArray(features)) continue
    for (const feature of features) {
      if (!feature || typeof feature.id !== 'string' || !feature.id) continue
      const declared = typeof feature.module === 'string' && feature.module.length > 0
        ? feature.module
        : mod.id
      featureToModule.set(feature.id, declared)
      const dot = feature.id.indexOf('.')
      if (dot > 0) {
        const prefix = feature.id.slice(0, dot)
        if (!prefixToModule.has(prefix)) prefixToModule.set(prefix, declared)
      }
    }
  }
  return { enabledModuleIds, enabledModuleSet, featureToModule, prefixToModule }
}

function getRegistry(): FeatureRegistry | null {
  try {
    const modules = getModules() as readonly Module[]
    if (cachedRegistry && cachedModulesRef === modules) return cachedRegistry
    cachedModulesRef = modules
    cachedRegistry = buildRegistry(modules)
    return cachedRegistry
  } catch {
    return null
  }
}

export function getOwningModuleId(featureId: string): string {
  const registry = getRegistry()
  if (registry) {
    const direct = registry.featureToModule.get(featureId)
    if (direct) return direct
    if (featureId.endsWith('.*')) {
      const prefix = featureId.slice(0, -2)
      const fromPrefix = registry.prefixToModule.get(prefix)
      if (fromPrefix) return fromPrefix
      return prefix
    }
  }
  const dot = featureId.indexOf('.')
  return dot === -1 ? featureId : featureId.slice(0, dot)
}

export function getEnabledModuleIds(): string[] {
  const registry = getRegistry()
  return registry ? [...registry.enabledModuleIds] : []
}

/**
 * Filters a raw granted-features list down to the grants whose owning
 * module is currently enabled. Expands `*` (superadmin) into one wildcard
 * per enabled module so the result is still safe to feed into a pure
 * `matchFeature` check, plus one wildcard per off-convention feature
 * prefix (e.g. `analytics.*`) whose declared owning module is enabled.
 * If the module registry is not populated (tests, CLI), returns the input
 * unchanged — preserves legacy behavior.
 */
export function filterGrantsByEnabledModules(granted: readonly string[]): string[] {
  const registry = getRegistry()
  if (!registry) return [...granted]
  const { enabledModuleIds, enabledModuleSet, prefixToModule } = registry
  const result: string[] = []
  for (const grant of granted) {
    if (grant === '*') {
      for (const id of enabledModuleIds) result.push(`${id}.*`)
      for (const [prefix, owningModule] of prefixToModule) {
        if (!enabledModuleSet.has(prefix) && enabledModuleSet.has(owningModule)) {
          result.push(`${prefix}.*`)
        }
      }
      continue
    }
    if (enabledModuleSet.has(getOwningModuleId(grant))) result.push(grant)
  }
  return result
}
