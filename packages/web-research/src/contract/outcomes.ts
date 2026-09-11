import { isWebResearchError, errorMessage } from './errors'
import type { FetchedPage, RawResult } from './results'

/**
 * Failure shapes shared by search and fetch. Keeping `unavailable`, `blocked`
 * and `error` distinct is the point of the whole contract: the scheduler demotes
 * an `unavailable` adapter for the rest of the run, escalates a `blocked` one to
 * the browser tier, and retries only a retriable `error`. Collapsing them into a
 * thrown exception — as the previous implementation did — makes all three
 * indistinguishable and forces the caller to guess.
 */
export type OutcomeFailure =
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'blocked'; readonly reason: string; readonly retryAfterMs?: number }
  | { readonly status: 'timeout'; readonly reason?: string }
  | { readonly status: 'error'; readonly reason: string; readonly retriable: boolean }

export type SearchOutcome =
  | { readonly status: 'ok'; readonly results: readonly RawResult[]; readonly answer?: string }
  | { readonly status: 'empty' }
  | OutcomeFailure

export type FetchOutcome = { readonly status: 'ok'; readonly page: FetchedPage } | OutcomeFailure

export type OutcomeStatus = SearchOutcome['status']

/**
 * A prose answer with no citations is still a successful search — the model
 * knew something, it just did not link anywhere. Only a turn that produced
 * neither links nor prose is `empty`.
 */
export function searchOk(results: readonly RawResult[], answer?: string): SearchOutcome {
  const hasAnswer = answer !== undefined && answer.trim().length > 0
  if (results.length === 0 && !hasAnswer) return { status: 'empty' }
  return hasAnswer ? { status: 'ok', results, answer } : { status: 'ok', results }
}

export function searchEmpty(): SearchOutcome {
  return { status: 'empty' }
}

export function unavailable(reason: string): OutcomeFailure {
  return { status: 'unavailable', reason }
}

export function blocked(reason: string, retryAfterMs?: number): OutcomeFailure {
  return retryAfterMs === undefined
    ? { status: 'blocked', reason }
    : { status: 'blocked', reason, retryAfterMs }
}

export function timedOut(reason?: string): OutcomeFailure {
  return reason === undefined ? { status: 'timeout' } : { status: 'timeout', reason }
}

export function failed(reason: string, retriable = false): OutcomeFailure {
  return { status: 'error', reason, retriable }
}

export function isFailure(outcome: SearchOutcome | FetchOutcome): outcome is OutcomeFailure {
  return outcome.status !== 'ok' && outcome.status !== 'empty'
}

/**
 * Maps anything thrown by the shared HTTP client onto the outcome vocabulary, so
 * an adapter body reduces to `try { … } catch (err) { return toOutcomeFailure(err) }`
 * and never leaks an exception to the scheduler.
 */
export function toOutcomeFailure(error: unknown): OutcomeFailure {
  if (isWebResearchError(error)) {
    switch (error.code) {
      case 'timeout':
        return timedOut(error.message)
      case 'aborted':
        return timedOut(error.message)
      case 'blocked':
        return blocked(error.message, error.retryAfterMs)
      case 'ssrf_blocked':
      case 'unsupported_content_type':
        return failed(error.message, false)
      case 'network':
      case 'bad_response':
      case 'too_many_redirects':
        return failed(error.message, true)
    }
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return timedOut(error.message)
  }
  return failed(errorMessage(error), false)
}
