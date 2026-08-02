export function parseNumberWithDefault(
  raw: string | null | undefined,
  fallback: number,
  options?: { min?: number; integer?: boolean },
): number {
  if (raw == null) return fallback
  const trimmed = raw.trim()
  if (!trimmed) return fallback
  const value = options?.integer ? Number.parseInt(trimmed, 10) : Number(trimmed)
  if (!Number.isFinite(value)) return fallback
  const min = options?.min ?? -Infinity
  if (value < min) return fallback
  return value
}
