export function resolveCatalogLabel(
  t: (key: string) => string,
  kind: 'severity' | 'type' | 'role',
  key: string | null | undefined,
  storedLabel: string,
): string {
  if (!key) return storedLabel
  const lookupKey = `incidents.catalog.${kind}.${key}`
  const translated = t(lookupKey)
  return translated === lookupKey ? storedLabel : translated
}
