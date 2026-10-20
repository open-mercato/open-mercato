const PROCESS_KEY_PARAM_MAX_LENGTH = 200

/** The process key of a `[processKey]` route segment (decoded once; malformed input stays as given). */
export function decodeProcessKeyParam(value: string | undefined): string {
  const raw = typeof value === 'string' ? value.slice(0, PROCESS_KEY_PARAM_MAX_LENGTH) : ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}
