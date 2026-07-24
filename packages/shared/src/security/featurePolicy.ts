import { hasAllFeatures as matchesAllFeatures } from './features'
import {
  filterGrantsByEnabledModules,
  getConcreteFeatureIds,
  getEnabledModuleIds,
  getOwningModuleId,
  hasEnabledModulesRegistry,
} from './enabledModulesRegistry'
import { composeAclFeatureOverrides } from '../modules/overrides'

export type FeaturePolicySubject = {
  grantedFeatures: readonly string[]
  unrestricted?: boolean
  scopeAllowed?: boolean
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
  if (subject.unrestricted === true) return true
  return matchesAllFeatures(
    filterGrantsByEnabledModules(subject.grantedFeatures),
    required,
  )
}

export function resolveEffectiveFeatures(
  grantedFeatures: readonly string[],
): string[] {
  const filteredGrants = filterGrantsByEnabledModules(grantedFeatures)
    .filter((featureId) => !isAclFeatureRemoved(featureId))

  if (!hasEnabledModulesRegistry()) {
    return filteredGrants.filter((featureId, index, features) => (
      featureId !== '*'
      && !featureId.endsWith('.*')
      && features.indexOf(featureId) === index
    ))
  }

  const result: string[] = []
  const seen = new Set<string>()
  const addFeature = (featureId: string) => {
    if (
      seen.has(featureId)
      || isAclFeatureRemoved(featureId)
      || !isFeatureEnabled(featureId)
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
