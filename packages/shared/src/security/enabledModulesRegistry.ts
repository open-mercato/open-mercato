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
 * This helper is server-only: it reads the enabled module set from the
 * bootstrapped module registry. The browser never imports it; instead,
 * server code pre-filters `BackendChromePayload.grantedFeatures` so
 * client-side `hasFeature` can stay a pure grant check.
 */

import { getModules } from '../lib/modules/registry'

export function getOwningModuleId(featureId: string): string {
  const dot = featureId.indexOf('.')
  return dot === -1 ? featureId : featureId.slice(0, dot)
}

function safeGetEnabledModuleIds(): string[] | null {
  try {
    return getModules().map((mod) => mod.id)
  } catch {
    return null
  }
}

export function getEnabledModuleIds(): string[] {
  return safeGetEnabledModuleIds() ?? []
}

/**
 * Filters a raw granted-features list down to the grants whose owning
 * module is currently enabled. Expands `*` (superadmin) into one wildcard
 * per enabled module so the result is still safe to feed into a pure
 * `matchFeature` check. If the module registry is not populated (tests,
 * CLI), returns the input unchanged — preserves legacy behavior.
 */
export function filterGrantsByEnabledModules(granted: readonly string[]): string[] {
  const enabledIds = safeGetEnabledModuleIds()
  if (enabledIds === null) return [...granted]
  const enabledSet = new Set(enabledIds)
  const result: string[] = []
  for (const grant of granted) {
    if (grant === '*') {
      for (const id of enabledIds) result.push(`${id}.*`)
      continue
    }
    if (enabledSet.has(getOwningModuleId(grant))) result.push(grant)
  }
  return result
}
