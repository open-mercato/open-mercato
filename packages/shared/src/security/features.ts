export function matchFeature(required: string, granted: string): boolean {
  if (granted === '*') return true
  if (granted.endsWith('.*')) {
    const prefix = granted.slice(0, -2)
    return required === prefix || required.startsWith(prefix + '.')
  }
  return granted === required
}

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
