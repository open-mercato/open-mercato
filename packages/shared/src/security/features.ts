export { matchFeature } from '../lib/auth/featureMatch'
import { matchFeature } from '../lib/auth/featureMatch'

export function hasFeature(granted: readonly string[] | undefined, required: string): boolean {
  if (!Array.isArray(granted) || !granted.length) return false
  return granted.some((feature) => matchFeature(required, feature))
}

export function hasAllFeatures(
  granted: readonly string[] | undefined,
  required: readonly string[] | undefined
): boolean {
  if (!required || required.length === 0) return true
  if (!Array.isArray(granted) || !granted.length) return false
  return required.every((feature) => hasFeature(granted, feature))
}

export type FeatureGrantSet = {
  features: readonly string[]
  isSuperAdmin: boolean
}

function normalizeFeatures(features: readonly string[]): string[] {
  return Array.from(new Set(features)).sort()
}

export function intersectFeatureGrants(
  first: FeatureGrantSet,
  second: FeatureGrantSet,
): FeatureGrantSet {
  if (first.isSuperAdmin && second.isSuperAdmin) {
    return { features: [], isSuperAdmin: true }
  }
  if (first.isSuperAdmin) {
    return { features: normalizeFeatures(second.features), isSuperAdmin: false }
  }
  if (second.isSuperAdmin) {
    return { features: normalizeFeatures(first.features), isSuperAdmin: false }
  }
  const kept: string[] = []
  for (const left of first.features) {
    for (const right of second.features) {
      if (matchFeature(left, right)) kept.push(left)
      else if (matchFeature(right, left)) kept.push(right)
    }
  }
  return { features: normalizeFeatures(kept), isSuperAdmin: false }
}
