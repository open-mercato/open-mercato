export function hasFeature(features: string[] | undefined, id: string): boolean {
  if (!features || !features.length) return false
  return features.some((feature) => {
    if (feature === '*') return true
    if (feature === id) return true
    if (feature.endsWith('.*')) {
      const prefix = feature.slice(0, -2)
      return id === prefix || id.startsWith(prefix + '.')
    }
    return false
  })
}
