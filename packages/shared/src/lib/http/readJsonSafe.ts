export async function readJsonSafe<T>(
  source: Request | Response | string,
  fallback: T | null = null,
): Promise<T | null> {
  const raw = typeof source === 'string' ? source : await source.text()
  if (!raw) return fallback

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}
