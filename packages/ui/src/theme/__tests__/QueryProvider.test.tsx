import {
  DEFAULT_QUERY_STALE_TIME_MS,
  buildDefaultQueryOptions,
  shouldRetryQuery,
} from '../QueryProvider'
import { UnauthorizedError } from '../../backend/utils/api'

describe('QueryProvider defaults', () => {
  const originalStaleTimeFlag = process.env.NEXT_PUBLIC_OM_QUERY_DEFAULT_STALE_TIME_ENABLED

  afterEach(() => {
    process.env.NEXT_PUBLIC_OM_QUERY_DEFAULT_STALE_TIME_ENABLED = originalStaleTimeFlag
  })

  it('does not retry deterministic 4xx query failures', () => {
    expect(shouldRetryQuery(0, new UnauthorizedError())).toBe(false)
    expect(shouldRetryQuery(0, { status: 400 })).toBe(false)
    expect(shouldRetryQuery(0, { status: 404 })).toBe(false)
  })

  it('keeps transient query failures retryable with a two-retry cap', () => {
    expect(shouldRetryQuery(0, { status: 408 })).toBe(true)
    expect(shouldRetryQuery(1, { status: 429 })).toBe(true)
    expect(shouldRetryQuery(1, { status: 503 })).toBe(true)
    expect(shouldRetryQuery(1, new Error('network'))).toBe(true)

    expect(shouldRetryQuery(2, { status: 503 })).toBe(false)
  })

  it('gates the shared staleTime default behind the public env flag', () => {
    process.env.NEXT_PUBLIC_OM_QUERY_DEFAULT_STALE_TIME_ENABLED = '0'
    expect(buildDefaultQueryOptions().staleTime).toBeUndefined()

    process.env.NEXT_PUBLIC_OM_QUERY_DEFAULT_STALE_TIME_ENABLED = '1'
    expect(buildDefaultQueryOptions().staleTime).toBe(DEFAULT_QUERY_STALE_TIME_MS)
  })
})
