import { hasAllFeatures as matchesAllFeatures, matchFeature } from './features'
import {
  filterGrantsByEnabledModules,
  getConcreteFeatureIds,
  getEnabledModuleIds,
  getFeatureCatalogIdentity,
  getOwningModuleId,
  hasEnabledModulesRegistry,
} from './enabledModulesRegistry'
import { composeAclFeatureOverrides } from '../modules/overrides'

export type UnavailableModuleIds = ReadonlySet<string> | readonly string[]

export type FeaturePolicySubject = {
  grantedFeatures: readonly string[]
  unrestricted?: boolean
  scopeAllowed?: boolean
  /**
   * Modules unavailable to the tenant this subject is evaluated in (per-tenant
   * module availability). Their features are denied before unrestricted and
   * wildcard grants are considered.
   */
  unavailableModuleIds?: UnavailableModuleIds
}

export type ResolveEffectiveFeaturesOptions = {
  unavailableModuleIds?: UnavailableModuleIds
}

export function getRemovedAclFeatureIds(): string[] {
  return Object.entries(composeAclFeatureOverrides())
    .filter(([, override]) => override === null)
    .map(([featureId]) => featureId)
}

export function isAclFeatureRemoved(featureId: string): boolean {
  return composeAclFeatureOverrides()[featureId] === null
}

function isFeatureEnabled(featureId: string): boolean {
  if (!hasEnabledModulesRegistry()) return true
  const enabledModuleIds = getEnabledModuleIds()
  return enabledModuleIds.includes(getOwningModuleId(featureId))
}

function toUnavailableModuleSet(
  unavailableModuleIds: UnavailableModuleIds | undefined,
): ReadonlySet<string> | null {
  if (!unavailableModuleIds) return null
  const set = unavailableModuleIds instanceof Set
    ? unavailableModuleIds as ReadonlySet<string>
    : new Set(unavailableModuleIds as readonly string[])
  return set.size > 0 ? set : null
}

function isOwnedByUnavailableModule(featureId: string, unavailable: ReadonlySet<string>): boolean {
  return unavailable.has(getOwningModuleId(featureId))
}

function isWildcardGrant(featureId: string): boolean {
  return featureId === '*' || featureId.endsWith('.*')
}

type GrantNarrowingPlan = {
  hasUnavailableConcrete: boolean
  unavailableBySegment: ReadonlyMap<string, readonly string[]>
  available: readonly string[]
  availableBySegment: ReadonlyMap<string, readonly string[]>
}

function appendToBucket(buckets: Map<string, string[]>, key: string, featureId: string): void {
  const bucket = buckets.get(key)
  if (bucket) bucket.push(featureId)
  else buckets.set(key, [featureId])
}

/**
 * A deployment rotates through as many distinct unavailable-module sets as it
 * has plan tiers or tenant kinds — typically a handful. Sixteen plans leave
 * headroom; beyond that the least recently used plan is evicted one at a time,
 * so there is no wholesale clear and no latency cliff.
 */
const MAX_GRANT_NARROWING_PLANS = 16
let grantNarrowingCatalog: object | null = null
const grantNarrowingPlans = new Map<string, GrantNarrowingPlan>()

/** @internal Number of memoized grant-narrowing plans (bounded LRU). */
export function getGrantNarrowingPlanCountForTests(): number {
  return grantNarrowingPlans.size
}

/** @internal Whether a narrowing plan for this unavailable set is memoized. */
export function hasGrantNarrowingPlanForTests(unavailableModuleIds: readonly string[]): boolean {
  return grantNarrowingPlans.has([...unavailableModuleIds].sort().join(','))
}

function firstSegment(featureId: string): string {
  const dot = featureId.indexOf('.')
  return dot === -1 ? featureId : featureId.slice(0, dot)
}

function getGrantNarrowingPlan(unavailable: ReadonlySet<string>): GrantNarrowingPlan {
  const catalog = getFeatureCatalogIdentity()
  if (catalog !== grantNarrowingCatalog) {
    grantNarrowingCatalog = catalog
    grantNarrowingPlans.clear()
  }
  const signature = Array.from(unavailable).sort().join(',')
  const existing = grantNarrowingPlans.get(signature)
  if (existing) {
    grantNarrowingPlans.delete(signature)
    grantNarrowingPlans.set(signature, existing)
    return existing
  }
  if (grantNarrowingPlans.size >= MAX_GRANT_NARROWING_PLANS) {
    const leastRecent = grantNarrowingPlans.keys().next().value
    if (leastRecent !== undefined) grantNarrowingPlans.delete(leastRecent)
  }
  const unavailableBySegment = new Map<string, string[]>()
  const available: string[] = []
  const availableBySegment = new Map<string, string[]>()
  for (const featureId of getConcreteFeatureIds()) {
    if (isOwnedByUnavailableModule(featureId, unavailable)) {
      appendToBucket(unavailableBySegment, firstSegment(featureId), featureId)
      continue
    }
    available.push(featureId)
    appendToBucket(availableBySegment, firstSegment(featureId), featureId)
  }
  const created: GrantNarrowingPlan = {
    hasUnavailableConcrete: unavailableBySegment.size > 0,
    unavailableBySegment,
    available,
    availableBySegment,
  }
  grantNarrowingPlans.set(signature, created)
  return created
}

function expandWildcardGrant(
  plan: GrantNarrowingPlan,
  wildcard: string,
  unavailable: ReadonlySet<string>,
): readonly string[] | null {
  if (wildcard === '*') return plan.hasUnavailableConcrete ? plan.available : null
  const segment = firstSegment(wildcard)
  const coversUnavailable = isOwnedByUnavailableModule(wildcard, unavailable)
    || (plan.unavailableBySegment.get(segment) ?? []).some((featureId) => matchFeature(featureId, wildcard))
  if (!coversUnavailable) return null
  const candidates = plan.availableBySegment.get(segment) ?? []
  return candidates.filter((featureId) => matchFeature(featureId, wildcard))
}

/**
 * Narrows a raw grant list to the modules available to a tenant, for consumers
 * that only receive grants and evaluate them later without the tenant.
 * Explicit grants owned by an unavailable module are dropped. A wildcard that
 * covers any feature of an unavailable module is replaced by the concrete
 * catalog features it still covers; other wildcards are kept verbatim. Only
 * wildcards that intersect an unavailable module are expanded, against a plan
 * memoized per (catalog, unavailable set). Without a module registry,
 * wildcards that cannot be expanded are dropped.
 */
export function filterGrantsByModuleAvailability(
  grantedFeatures: readonly string[],
  unavailableModuleIds: UnavailableModuleIds | undefined,
): string[] {
  const unavailable = toUnavailableModuleSet(unavailableModuleIds)
  if (!unavailable) return [...grantedFeatures]

  const plan = hasEnabledModulesRegistry() ? getGrantNarrowingPlan(unavailable) : null
  const result: string[] = []
  const seen = new Set<string>()
  const add = (featureId: string) => {
    if (seen.has(featureId)) return
    seen.add(featureId)
    result.push(featureId)
  }

  for (const featureId of grantedFeatures) {
    if (!isWildcardGrant(featureId)) {
      if (!isOwnedByUnavailableModule(featureId, unavailable)) add(featureId)
      continue
    }
    if (!plan) {
      if (featureId !== '*' && !isOwnedByUnavailableModule(featureId, unavailable)) add(featureId)
      continue
    }
    const expansion = expandWildcardGrant(plan, featureId, unavailable)
    if (expansion === null) {
      add(featureId)
      continue
    }
    for (const concrete of expansion) add(concrete)
  }
  return result
}

export function authorizeFeatures(
  required: readonly string[],
  subject: FeaturePolicySubject,
): boolean {
  if (required.length === 0) return true
  if (subject.scopeAllowed === false) return false
  if (required.some((featureId) => (
    isAclFeatureRemoved(featureId) || !isFeatureEnabled(featureId)
  ))) {
    return false
  }
  const unavailable = toUnavailableModuleSet(subject.unavailableModuleIds)
  if (unavailable && required.some((featureId) => isOwnedByUnavailableModule(featureId, unavailable))) {
    return false
  }
  if (subject.unrestricted === true) return true
  return matchesAllFeatures(
    filterGrantsByEnabledModules(subject.grantedFeatures),
    required,
  )
}

export function resolveEffectiveFeatures(
  grantedFeatures: readonly string[],
  options?: ResolveEffectiveFeaturesOptions,
): string[] {
  const unavailable = toUnavailableModuleSet(options?.unavailableModuleIds)
  const filteredGrants = filterGrantsByEnabledModules(grantedFeatures)
    .filter((featureId) => !isAclFeatureRemoved(featureId))

  if (!hasEnabledModulesRegistry()) {
    return filteredGrants.filter((featureId, index, features) => (
      featureId !== '*'
      && !featureId.endsWith('.*')
      && features.indexOf(featureId) === index
      && !(unavailable && isOwnedByUnavailableModule(featureId, unavailable))
    ))
  }

  const result: string[] = []
  const seen = new Set<string>()
  const addFeature = (featureId: string) => {
    if (
      seen.has(featureId)
      || isAclFeatureRemoved(featureId)
      || !isFeatureEnabled(featureId)
      || (unavailable !== null && isOwnedByUnavailableModule(featureId, unavailable))
    ) {
      return
    }
    seen.add(featureId)
    result.push(featureId)
  }

  for (const featureId of getConcreteFeatureIds()) {
    if (matchesAllFeatures(filteredGrants, [featureId])) addFeature(featureId)
  }

  for (const featureId of filteredGrants) {
    if (featureId === '*' || featureId.endsWith('.*')) continue
    addFeature(featureId)
  }

  return result
}
