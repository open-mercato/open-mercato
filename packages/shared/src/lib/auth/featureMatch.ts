export type FeatureEntry = { id: string; title?: string; module?: string }

export function featureString(entry: FeatureEntry | string): string {
  return typeof entry === 'string' ? entry : entry.id
}

export function featureScope(featureId: string): string {
  const dotIndex = featureId.indexOf('.')
  return dotIndex === -1 ? featureId : featureId.slice(0, dotIndex)
}

export function extractFeatureStrings(entries: Array<FeatureEntry | string>): string[] {
  return entries.map(featureString)
}

/**
 * Checks if a required feature is satisfied by a granted feature permission.
 *
 * Wildcard patterns:
 * - `*` (global wildcard): Grants access to all features
 * - `prefix.*` (module wildcard): Grants access to all features starting with `prefix.`
 *   and also the exact prefix itself
 * - Exact match: Feature must match exactly
 */
export function matchFeature(required: string, granted: string): boolean {
  if (granted === '*') return true
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2)
    return required === prefix || required.startsWith(prefix + '.')
  }
  return granted === required
}

/**
 * Checks if all required features are satisfied by the granted feature set.
 */
export function hasAllFeatures(required: string[], granted: string[]): boolean {
  if (!required.length) return true
  if (!granted.length) return false
  return required.every((req) => granted.some((g) => matchFeature(req, g)))
}
