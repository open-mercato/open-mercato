const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export function hasOwnProperty<T extends object>(target: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(target, key)
}

export function readOwnProperty<T extends object, K extends keyof T>(
  target: T | null | undefined,
  key: K,
): T[K] | undefined {
  if (!target || typeof target !== 'object') return undefined
  return hasOwnProperty(target, key) ? target[key] : undefined
}

export function isSafeIdentifier(value: unknown): value is string {
  return typeof value === 'string' && SAFE_IDENTIFIER_PATTERN.test(value)
}

export function assertSafeIdentifier(value: unknown, label: string): string {
  if (!isSafeIdentifier(value)) {
    throw new Error(`Invalid ${label}: ${String(value)}`)
  }
  return value
}
