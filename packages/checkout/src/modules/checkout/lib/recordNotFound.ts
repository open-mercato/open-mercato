function readErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null
  const candidate = error as Record<string, unknown>
  if (typeof candidate.status === 'number') return candidate.status
  for (const key of ['body', 'response', 'data']) {
    const nested = candidate[key]
    if (nested && typeof nested === 'object') {
      const status = (nested as Record<string, unknown>).status
      if (typeof status === 'number') return status
    }
  }
  return null
}

export function isRecordNotFoundError(error: unknown): boolean {
  return readErrorStatus(error) === 404
}
