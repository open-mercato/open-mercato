export function normalizeTestPath(value: string): string {
  return value.replace(/\\/g, '/')
}

export function pathIncludes(value: string, needle: string): boolean {
  return normalizeTestPath(value).includes(normalizeTestPath(needle))
}
