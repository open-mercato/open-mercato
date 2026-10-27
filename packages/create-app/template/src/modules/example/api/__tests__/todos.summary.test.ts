/** @jest-environment node */
/**
 * The summary route is the read side of the module cache. What it must never do is
 * let a caller choose the scope: the scope becomes part of the cache key, so a
 * caller-supplied tenant or organization would let one session both populate and
 * read another session's entry.
 */
const TENANT_A = '00000000-0000-4000-8000-00000000000a'
const ORG_A1 = '00000000-0000-4000-8000-0000000000a1'

const mockAuth: { value: { orgId?: string | null; tenantId?: string | null } | null } = { value: null }

const readSummary = jest.fn(async () => ({
  summary: { total: 5, done: 2, open: 3, tenantId: TENANT_A, organizationId: ORG_A1 },
  cacheHit: true,
}))

const resolvedTokens: string[] = []

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromCookies: jest.fn(async () => mockAuth.value),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      resolvedTokens.push(token)
      return { read: readSummary, invalidate: jest.fn() }
    },
  })),
}))

import { GET, metadata } from '../todos/summary/route'

describe('example todo summary route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    resolvedTokens.length = 0
    mockAuth.value = { orgId: ORG_A1, tenantId: TENANT_A }
  })

  it('requires authentication and the todo view feature', () => {
    expect(metadata.GET).toEqual({ requireAuth: true, requireFeatures: ['example.todos.view'] })
  })

  it('reads the summary for the session scope through the module DI token', async () => {
    const response = await GET()

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ total: 5, done: 2, open: 3, cacheHit: true })
    expect(resolvedTokens).toEqual(['exampleTodoSummaryService'])
    expect(readSummary).toHaveBeenCalledWith({ tenantId: TENANT_A, organizationId: ORG_A1 })
  })

  it('does not echo the cached scope back to the caller', async () => {
    const body = (await (await GET()).json()) as Record<string, unknown>

    expect(body).not.toHaveProperty('tenantId')
    expect(body).not.toHaveProperty('organizationId')
  })

  it('returns 401 without a tenant instead of reading an unscoped summary', async () => {
    mockAuth.value = { orgId: ORG_A1, tenantId: null }

    const response = await GET()

    expect(response.status).toBe(401)
    expect(readSummary).not.toHaveBeenCalled()
  })

  it('returns 400 without an organization instead of reading a tenant-wide summary', async () => {
    mockAuth.value = { orgId: null, tenantId: TENANT_A }

    const response = await GET()

    expect(response.status).toBe(400)
    expect(readSummary).not.toHaveBeenCalled()
  })

  it('returns 500 rather than a partial body when the service fails', async () => {
    readSummary.mockRejectedValueOnce(new Error('[internal] boom'))

    const response = await GET()

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Internal server error' })
  })
})
