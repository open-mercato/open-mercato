import { hasFeature } from './features'

export type FeatureDescriptor = {
  id: string
  title?: string
  module?: string
  dependsOn?: readonly string[]
}

export type MissingDependency = {
  feature: string
  missing: readonly string[]
}

export type OrphanedDependent = {
  dependency: string
  dependents: readonly string[]
}

export type UnknownReference = {
  feature: string
  missing: readonly string[]
}

export type AclDependencyDiagnostics = {
  missingDependencies: readonly MissingDependency[]
  orphanedDependents: readonly OrphanedDependent[]
  unknownReferences: readonly UnknownReference[]
}

const EMPTY_DIAGNOSTICS: AclDependencyDiagnostics = Object.freeze({
  missingDependencies: Object.freeze([]),
  orphanedDependents: Object.freeze([]),
  unknownReferences: Object.freeze([]),
})

function normalizeGranted(granted: readonly string[] | undefined): string[] {
  if (!Array.isArray(granted)) return []
  const set = new Set<string>()
  for (const entry of granted) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (!trimmed) continue
    set.add(trimmed)
  }
  return Array.from(set)
}

function indexCatalog(catalog: readonly FeatureDescriptor[]): Map<string, FeatureDescriptor> {
  const map = new Map<string, FeatureDescriptor>()
  for (const descriptor of catalog) {
    if (!descriptor || typeof descriptor.id !== 'string') continue
    const id = descriptor.id.trim()
    if (!id) continue
    if (!map.has(id)) map.set(id, descriptor)
  }
  return map
}

export function resolveAclDependencyDiagnostics(
  granted: readonly string[] | undefined,
  catalog: readonly FeatureDescriptor[] | undefined,
): AclDependencyDiagnostics {
  if (!Array.isArray(catalog) || catalog.length === 0) return EMPTY_DIAGNOSTICS
  const grantedList = normalizeGranted(granted)
  if (grantedList.includes('*')) return EMPTY_DIAGNOSTICS

  const catalogIndex = indexCatalog(catalog)

  const missingDependencies: MissingDependency[] = []
  const unknownReferences: UnknownReference[] = []
  const dependentsByDependency = new Map<string, Set<string>>()

  for (const descriptor of catalog) {
    if (!descriptor || typeof descriptor.id !== 'string') continue
    const featureId = descriptor.id.trim()
    if (!featureId) continue
    const deps = Array.isArray(descriptor.dependsOn) ? descriptor.dependsOn : []
    if (deps.length === 0) continue

    if (!hasFeature(grantedList, featureId)) continue

    const missing: string[] = []
    const unknown: string[] = []
    for (const rawDep of deps) {
      if (typeof rawDep !== 'string') continue
      const dep = rawDep.trim()
      if (!dep) continue
      const isRegistered = catalogIndex.has(dep) || dep.endsWith('.*') || dep === '*'
      if (!isRegistered) {
        unknown.push(dep)
        continue
      }
      if (!hasFeature(grantedList, dep)) {
        missing.push(dep)
        const bucket = dependentsByDependency.get(dep) ?? new Set<string>()
        bucket.add(featureId)
        dependentsByDependency.set(dep, bucket)
      }
    }

    if (missing.length > 0) {
      missingDependencies.push({ feature: featureId, missing: dedupe(missing) })
    }
    if (unknown.length > 0) {
      unknownReferences.push({ feature: featureId, missing: dedupe(unknown) })
    }
  }

  const orphanedDependents: OrphanedDependent[] = []
  for (const [dep, dependents] of dependentsByDependency) {
    const known = catalogIndex.has(dep)
    if (!known) continue
    orphanedDependents.push({
      dependency: dep,
      dependents: Array.from(dependents).sort((a, b) => a.localeCompare(b)),
    })
  }
  orphanedDependents.sort((a, b) => a.dependency.localeCompare(b.dependency))

  return {
    missingDependencies,
    orphanedDependents,
    unknownReferences: unknownReferences.sort((a, b) => a.feature.localeCompare(b.feature)),
  }
}

function dedupe(values: readonly string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b))
}

export function applyAddMissingDependency(
  granted: readonly string[],
  dependency: string,
): string[] {
  if (!dependency || !dependency.trim()) return [...granted]
  if (granted.includes(dependency)) return [...granted]
  return [...granted, dependency]
}

export function applyRemoveDependents(
  granted: readonly string[],
  dependents: readonly string[],
): string[] {
  if (!dependents.length) return [...granted]
  const dropSet = new Set(dependents)
  return granted.filter((feature) => !dropSet.has(feature))
}

export function applyRestoreDependency(
  granted: readonly string[],
  dependency: string,
): string[] {
  return applyAddMissingDependency(granted, dependency)
}
