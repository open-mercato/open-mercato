/**
 * Reads a field of a failed API call's JSON body from the error `apiCallOrThrow` throws.
 *
 * `raiseCrudError` copies the body's fields onto the thrown error itself, so the code is `error.code`. Every screen
 * in this module read `error.body.code`, which is always undefined — so every specific message ("the last step is a
 * wait", "a block with that reference already exists") was replaced by the generic "could not save". A nested `body`
 * is still read as a fallback, for an error that did not come through that path.
 */
export function readApiErrorField(error: unknown, key: 'code' | 'detail' | 'error'): string | null {
  if (!error || typeof error !== 'object') return null
  const direct = (error as Record<string, unknown>)[key]
  if (typeof direct === 'string') return direct
  const body = (error as { body?: unknown }).body
  if (body && typeof body === 'object') {
    const nested = (body as Record<string, unknown>)[key]
    if (typeof nested === 'string') return nested
  }
  return null
}
