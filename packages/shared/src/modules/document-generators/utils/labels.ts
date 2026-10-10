export function buildLabels<Key extends string>(
  keys: readonly Key[],
  defaults: Record<Key, string>,
  translationPrefix: string,
  translate: (key: string, fallback?: string) => string,
): Record<Key, string> {
  const entries = keys.map((key) => [key, translate(`${translationPrefix}.${key}`, defaults[key])])
  return Object.fromEntries(entries) as Record<Key, string>
}
