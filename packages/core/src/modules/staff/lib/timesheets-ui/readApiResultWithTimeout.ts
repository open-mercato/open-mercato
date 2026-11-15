import {
  readApiResultOrThrow,
  type ReadApiResultOrThrowOptions,
} from '@open-mercato/ui/backend/utils/apiCall'

export const REQUEST_TIMEOUT_MS = 12_000

export type TimedReadOptions<TReturn> = ReadApiResultOrThrowOptions<TReturn> & {
  allowNullResult?: false
  errorMessage: string
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: string }).name === 'AbortError'
  )
}

/**
 * Reads an API result like `readApiResultOrThrow`, but aborts the request after
 * `timeoutMs` and rejects with `options.errorMessage`, so a hung read settles into
 * the caller's error state instead of leaving the page on its loading state.
 */
export async function readApiResultWithTimeout<TReturn = Record<string, unknown>>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: TimedReadOptions<TReturn>,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<TReturn> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await readApiResultOrThrow<TReturn>(
      input,
      { ...(init ?? {}), signal: controller.signal },
      options,
    )
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(options.errorMessage)
    }
    throw error
  } finally {
    window.clearTimeout(timeoutId)
  }
}
