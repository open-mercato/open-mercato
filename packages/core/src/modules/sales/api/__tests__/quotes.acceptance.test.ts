/** @jest-environment node */
import { POST as sendQuote } from '@open-mercato/core/modules/sales/api/quotes/send/route'
import { GET as getPublicQuote } from '@open-mercato/core/modules/sales/api/quotes/public/[token]/route'
import { POST as acceptQuote } from '@open-mercato/core/modules/sales/api/quotes/accept/route'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { hashAuthToken } from '@open-mercato/core/modules/auth/lib/tokenHash'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const mockCommandBus = { execute: jest.fn() }
const mockRateLimiterService = { trustProxyDepth: 1, consume: jest.fn() }
const mockEm: Record<string, jest.Mock> = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
  transactional: jest.fn().mockImplementation(async (callback: (trx: any) => Promise<unknown>) => callback(mockEm)),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'commandBus') return mockCommandBus
      if (token === 'em') return mockEm
      if (token === 'accessLogService') return null
      return null
    },
  })),
}))

jest.mock('@open-mercato/core/bootstrap', () => ({
  getCachedRateLimiterService: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
  detectLocale: jest.fn().mockResolvedValue('en'),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: jest.fn(),
}))

function makeRequest(body: unknown) {
  return new Request('http://localhost/api/sales/quotes/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeAcceptRequest(body: unknown) {
  return new Request('http://localhost/api/sales/quotes/accept', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://localhost',
    },
    body: JSON.stringify(body),
  })
}

describe('quote send + accept flow', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRateLimiterService.consume.mockResolvedValue({ allowed: true, remainingPoints: 9, msBeforeNext: 0 })
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getCachedRateLimiterService } = await import('@open-mercato/core/bootstrap')
    const { resolveOrganizationScopeForRequest } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000000',
      orgId: '11111111-1111-4111-8111-111111111111',
      roles: ['admin'],
    })
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(mockRateLimiterService)
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: '11111111-1111-4111-8111-111111111111',
      filterIds: ['11111111-1111-4111-8111-111111111111'],
      allowedIds: ['11111111-1111-4111-8111-111111111111'],
    })
  })

  test('send sets status=sent, token and validUntil', async () => {
    const quote = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-1',
      currencyCode: 'USD',
      grandTotalGrossAmount: '10',
      status: 'draft',
      statusEntryId: null,
      customerSnapshot: { customer: { primaryEmail: 'test@example.com' } },
      metadata: null,
      updatedAt: new Date(),
      validUntil: null,
      sentAt: null,
      acceptanceToken: null,
    }

    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) return where?.id === quote.id ? quote : null
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-sent' }
      return null
    })

    const res = await sendQuote(makeRequest({ quoteId: quote.id, validForDays: 14 }))
    expect(res.status).toBe(200)
    expect(quote.status).toBe('sent')
    expect(quote.acceptanceToken).toBeTruthy()
    // Stored token must be a hash, not a UUID
    expect(quote.acceptanceToken).toHaveLength(64)
    expect(quote.acceptanceToken).toMatch(/^[0-9a-f]{64}$/)
    expect(quote.validUntil).toBeInstanceOf(Date)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  test('accept falls back to raw token lookup for quotes sent before hashing rollout', async () => {
    const LEGACY_RAW_TOKEN = '77777777-7777-4777-8777-777777777777'
    const legacyQuote = {
      id: '66666666-6666-4666-8666-666666666666',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-LEGACY',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
      acceptanceToken: LEGACY_RAW_TOKEN,
    }

    const seenWhereTokens: Array<string | undefined> = []
    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) {
        seenWhereTokens.push(where?.acceptanceToken)
        return where?.acceptanceToken === LEGACY_RAW_TOKEN ? legacyQuote : null
      }
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-legacy', orderNumber: 'SO-LEGACY', deletedAt: null }
      return null
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-legacy' } })

    const res = await acceptQuote(makeAcceptRequest({ token: LEGACY_RAW_TOKEN }))
    expect(res.status).toBe(200)
    expect(seenWhereTokens[0]).toBe(hashAuthToken(LEGACY_RAW_TOKEN))
    expect(seenWhereTokens[1]).toBe(LEGACY_RAW_TOKEN)
    expect(legacyQuote.status).toBe('confirmed')
  })

  test('public view returns expired flag', async () => {
    const quote = {
      id: 'q-1',
      tenantId: '00000000-0000-4000-8000-000000000000',
      quoteNumber: 'SQ-1',
      currencyCode: 'USD',
      status: 'sent',
      validFrom: null,
      validUntil: new Date(Date.now() - 60_000),
      subtotalNetAmount: '0',
      subtotalGrossAmount: '0',
      discountTotalAmount: '0',
      taxTotalAmount: '0',
      grandTotalNetAmount: '0',
      grandTotalGrossAmount: '0',
    }
    mockEm.findOne.mockResolvedValue(quote)
    mockEm.find.mockResolvedValue([])
    const res = await getPublicQuote(new Request('http://localhost/api/sales/quotes/public/x'), { params: { token: '00000000-0000-4000-8000-000000000000' } } as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.isExpired).toBe(true)
  })

  test('accept converts quote to order', async () => {
    const quote = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-1',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }

    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) return where?.acceptanceToken ? quote : null
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-1', orderNumber: 'SO-1', deletedAt: null }
      return null
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-1' }, logEntry: null })

    const res = await acceptQuote(makeAcceptRequest({ token: '00000000-0000-4000-8000-000000000000' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderId).toBe('order-1')
    expect(quote.status).toBe('confirmed')
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.quotes.convert_to_order',
      expect.objectContaining({ input: { quoteId: quote.id } })
    )
  })

  test('accept rejects cross-site browser POSTs', async () => {
    const res = await acceptQuote(
      new Request('http://localhost/api/sales/quotes/accept', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://evil.example',
        },
        body: JSON.stringify({ token: '00000000-0000-4000-8000-000000000000' }),
      })
    )

    expect(res.status).toBe(403)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })

  test('accept returns 429 when public endpoint rate limit is exceeded', async () => {
    mockRateLimiterService.consume.mockResolvedValueOnce({
      allowed: false,
      remainingPoints: 0,
      msBeforeNext: 60_000,
    })

    const res = await acceptQuote(
      new Request('http://localhost/api/sales/quotes/accept', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'http://localhost',
          'x-forwarded-for': '203.0.113.10',
        },
        body: JSON.stringify({ token: '00000000-0000-4000-8000-000000000000' }),
      })
    )

    expect(res.status).toBe(429)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})

describe('public view - tenant isolation (fix: cross-tenant auth returns 404)', () => {
  const TENANT_ID = '00000000-0000-4000-8000-000000000000'
  const OTHER_TENANT_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
  const TOKEN = '00000000-0000-4000-8000-000000000001'

  const baseQuote = {
    id: 'q-tenant-test',
    tenantId: TENANT_ID,
    quoteNumber: 'SQ-T1',
    currencyCode: 'USD',
    status: 'sent',
    validFrom: null,
    validUntil: null,
    subtotalNetAmount: '0',
    subtotalGrossAmount: '0',
    discountTotalAmount: '0',
    taxTotalAmount: '0',
    grandTotalNetAmount: '0',
    grandTotalGrossAmount: '0',
  }

  function makePublicReq() {
    return new Request(`http://localhost/api/sales/quotes/public/${TOKEN}`)
  }

  function makePublicCtx() {
    return { params: { token: TOKEN } } as any
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockEm.findOne.mockResolvedValue({ ...baseQuote })
    mockEm.find.mockResolvedValue([])
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
  })

  test('unauthenticated request returns quote (200)', async () => {
    const res = await getPublicQuote(makePublicReq(), makePublicCtx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quote.quoteNumber).toBe('SQ-T1')
  })

  test('authenticated same-tenant request returns quote (200)', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT_ID })

    const res = await getPublicQuote(makePublicReq(), makePublicCtx())
    expect(res.status).toBe(200)
  })

  test('authenticated cross-tenant request returns 404', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: OTHER_TENANT_ID })

    const res = await getPublicQuote(makePublicReq(), makePublicCtx())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })
})

describe('accept - tenant isolation (fix: tenantId scoped in lookup + encryption scope)', () => {
  const TENANT_ID = '00000000-0000-4000-8000-000000000000'
  const OTHER_TENANT_ID = 'ffffffff-ffff-4fff-bfff-ffffffffffff'
  const ACCEPTANCE_TOKEN = '00000000-0000-4000-8000-000000000002'

  // Fresh quote per test — the route mutates quote.status to 'confirmed' so it must not be shared
  let quote: Record<string, unknown>

  function makeAcceptReq() {
    return makeAcceptRequest({ token: ACCEPTANCE_TOKEN })
  }

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-sec-1' } })
    // Recreate quote each test so route mutations (status → 'confirmed') don't leak
    quote = {
      id: '55555555-5555-4555-8555-555555555555',
      tenantId: TENANT_ID,
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-SEC-1',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }
    // Simulate DB: honour tenantId in where clause (cross-tenant lookup returns null)
    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) {
        if (where?.tenantId && where.tenantId !== TENANT_ID) return null
        return where?.acceptanceToken === ACCEPTANCE_TOKEN ? quote : null
      }
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-sec-1', orderNumber: 'SO-SEC-1', deletedAt: null }
      return null
    })
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
  })

  test('unauthenticated accept succeeds (no tenantId filter applied)', async () => {
    const res = await acceptQuote(makeAcceptReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderId).toBe('order-sec-1')
  })

  test('same-tenant auth accepts quote (200)', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT_ID })

    const res = await acceptQuote(makeAcceptReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderId).toBe('order-sec-1')
  })

  test('cross-tenant auth returns 404 — tenantId included in lookup filter', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: OTHER_TENANT_ID })

    const res = await acceptQuote(makeAcceptReq())
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBeTruthy()
  })

  test('authenticated accept passes tenantId in the em.findOne where clause', async () => {
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ tenantId: TENANT_ID })

    let capturedWhere: Record<string, unknown> | null = null
    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) {
        capturedWhere = where
        return where?.acceptanceToken === ACCEPTANCE_TOKEN ? quote : null
      }
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-sec-1', orderNumber: 'SO-SEC-1', deletedAt: null }
      return null
    })

    await acceptQuote(makeAcceptReq())
    expect(capturedWhere?.tenantId).toBe(TENANT_ID)
  })
})

describe('accept - TOCTOU concurrency guard', () => {
  const ACCEPTANCE_TOKEN = '00000000-0000-4000-8000-000000000099'

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRateLimiterService.consume.mockResolvedValue({ allowed: true, remainingPoints: 9, msBeforeNext: 0 })
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getCachedRateLimiterService } = await import('@open-mercato/core/bootstrap')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(mockRateLimiterService)
  })

  test('accept uses pessimistic write lock and transaction to prevent TOCTOU', async () => {
    const quote = {
      id: '77777777-7777-4777-8777-777777777777',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-LOCK-1',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }

    let transactionalCallbackExecuted = false
    mockEm.transactional = jest.fn(async (callback: (trx: any) => Promise<unknown>) => {
      transactionalCallbackExecuted = true
      return callback(mockEm)
    }) as any

    const findOneOptions: Array<Record<string, unknown>> = []
    mockEm.findOne.mockImplementation(async (cls: any, _where: any, opts?: any) => {
      if (opts) findOneOptions.push(opts)
      if (cls === SalesQuote) return quote
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-lock-1', orderNumber: 'SO-LOCK-1', deletedAt: null }
      return null
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-lock-1' } })

    const res = await acceptQuote(makeAcceptRequest({ token: ACCEPTANCE_TOKEN }))
    expect(res.status).toBe(200)

    expect(transactionalCallbackExecuted).toBe(true)
    expect(mockEm.transactional).toHaveBeenCalled()

    const lockOption = findOneOptions.find(opt => opt.lockMode !== undefined)
    expect(lockOption).toBeDefined()
    expect(lockOption!.lockMode).toBe(LockMode.PESSIMISTIC_WRITE)
  })

  test('second concurrent accept is rejected by status check under lock', async () => {
    const quote = {
      id: '88888888-8888-4888-8888-888888888888',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-RACE-1',
      status: 'confirmed',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }

    mockEm.transactional = jest.fn(async (callback: (trx: any) => Promise<unknown>) => {
      return callback(mockEm)
    }) as any

    mockEm.findOne.mockImplementation(async (cls: any) => {
      if (cls === SalesQuote) return quote
      return null
    })

    const res = await acceptQuote(makeAcceptRequest({ token: ACCEPTANCE_TOKEN }))
    expect(res.status).toBe(400)
    expect(mockCommandBus.execute).not.toHaveBeenCalled()
  })
})

describe('accept - state rollback on conversion failure (fix: #1415)', () => {
  const ACCEPTANCE_TOKEN = '00000000-0000-4000-8000-000000000003'

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRateLimiterService.consume.mockResolvedValue({ allowed: true, remainingPoints: 9, msBeforeNext: 0 })
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getCachedRateLimiterService } = await import('@open-mercato/core/bootstrap')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(mockRateLimiterService)
  })

  test('reverts quote status to sent when order conversion fails', async () => {
    const quote = {
      id: '99999999-9999-4999-8999-999999999999',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-REVERT-1',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }

    mockEm.transactional = jest.fn(async (callback: (trx: any) => Promise<unknown>) => {
      return callback(mockEm)
    }) as any

    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) {
        if (where?.acceptanceToken) return quote
        if (where?.id === quote.id) return quote
        return null
      }
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      return null
    })

    mockCommandBus.execute.mockRejectedValue(new Error('Conversion failed'))

    const res = await acceptQuote(makeAcceptRequest({ token: ACCEPTANCE_TOKEN }))
    expect(res.status).toBe(400)
    expect(quote.status).toBe('sent')
  })
})

describe('send - no flush before email delivery (fix: #1415)', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { resolveOrganizationScopeForRequest } = await import('@open-mercato/core/modules/directory/utils/organizationScope')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue({
      sub: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000000',
      orgId: '11111111-1111-4111-8111-111111111111',
      roles: ['admin'],
    })
    ;(resolveOrganizationScopeForRequest as jest.Mock).mockResolvedValue({
      selectedId: '11111111-1111-4111-8111-111111111111',
      filterIds: ['11111111-1111-4111-8111-111111111111'],
      allowedIds: ['11111111-1111-4111-8111-111111111111'],
    })
  })

  test('does not persist quote state when email delivery fails', async () => {
    const quote = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-NOEMAIL-1',
      currencyCode: 'USD',
      grandTotalGrossAmount: '10',
      status: 'draft',
      statusEntryId: null,
      customerSnapshot: { customer: { primaryEmail: 'test@example.com' } },
      metadata: null,
      updatedAt: new Date(),
      validUntil: null,
      sentAt: null,
      acceptanceToken: null,
    }

    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) return where?.id === quote.id ? quote : null
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-sent' }
      return null
    })

    const { sendEmail } = await import('@open-mercato/shared/lib/email/send')
    ;(sendEmail as jest.Mock).mockRejectedValueOnce(new Error('SMTP connection refused'))

    const res = await sendQuote(makeRequest({ quoteId: quote.id, validForDays: 14 }))
    expect(res.status).toBe(400)
    expect(mockEm.flush).not.toHaveBeenCalled()
  })

  test('persists quote state only after email delivery succeeds', async () => {
    const quote = {
      id: '22222222-2222-4222-8222-222222222222',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-OK-1',
      currencyCode: 'USD',
      grandTotalGrossAmount: '10',
      status: 'draft',
      statusEntryId: null,
      customerSnapshot: { customer: { primaryEmail: 'test@example.com' } },
      metadata: null,
      updatedAt: new Date(),
      validUntil: null,
      sentAt: null,
      acceptanceToken: null,
    }

    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) return where?.id === quote.id ? quote : null
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-sent' }
      return null
    })

    const callOrder: string[] = []
    mockEm.flush.mockImplementation(async () => {
      callOrder.push('flush')
    })

    const { sendEmail } = await import('@open-mercato/shared/lib/email/send')
    ;(sendEmail as jest.Mock).mockImplementation(async () => {
      callOrder.push('sendEmail')
    })

    const res = await sendQuote(makeRequest({ quoteId: quote.id, validForDays: 14 }))
    expect(res.status).toBe(200)
    expect(callOrder.indexOf('sendEmail')).toBeLessThan(callOrder.indexOf('flush'))
  })
})

describe('quote editing invalidates sent token', () => {
  test('updating a sent quote clears token and reverts status to draft', async () => {
    // Registers commands (including sales.quotes.update) into the global command registry.
    await import('@open-mercato/core/modules/sales/commands/documents')

    const handler = commandRegistry.get<any, any>('sales.quotes.update')
    expect(handler).toBeTruthy()

    const quote: any = {
      id: '33333333-3333-4333-8333-333333333333',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      status: 'sent',
      statusEntryId: 'entry-sent',
      acceptanceToken: '44444444-4444-4444-8444-444444444444',
      sentAt: new Date(),
      currencyCode: 'USD',
      updatedAt: new Date(),
    }

    mockEm.fork.mockReturnValue(mockEm)
    mockEm.findOne.mockImplementation(async (cls: any, where: any) => {
      if (cls === SalesQuote) return where?.id === quote.id ? quote : null
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-draft' }
      return null
    })
    mockEm.flush.mockResolvedValue(undefined)

    const ctx: any = {
      container: { resolve: (token: string) => (token === 'em' ? mockEm : null) },
      auth: { sub: 'user-1', tenantId: quote.tenantId, orgId: quote.organizationId },
      organizationScope: null,
      selectedOrganizationId: quote.organizationId,
      organizationIds: [quote.organizationId],
    }

    await handler!.execute({ id: quote.id, comment: 'updated' }, ctx)

    expect(quote.acceptanceToken).toBeNull()
    expect(quote.sentAt).toBeNull()
    expect(quote.status).toBe('draft')
  })
})

// ---------------------------------------------------------------------------
// Regression: quote double-acceptance prevention — no non-transactional fallback (issue #1414)
// ---------------------------------------------------------------------------

describe('accept - always uses em.transactional (no fallback)', () => {
  const ACCEPTANCE_TOKEN = '00000000-0000-4000-8000-0000000014a0'

  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockRateLimiterService.consume.mockResolvedValue({ allowed: true, remainingPoints: 9, msBeforeNext: 0 })
    const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
    const { getCachedRateLimiterService } = await import('@open-mercato/core/bootstrap')
    ;(getAuthFromRequest as jest.Mock).mockResolvedValue(null)
    ;(getCachedRateLimiterService as jest.Mock).mockReturnValue(mockRateLimiterService)
  })

  test('accept calls em.transactional unconditionally — no non-transactional fallback path', async () => {
    const quote = {
      id: '99999999-9999-4999-8999-999999999999',
      tenantId: '00000000-0000-4000-8000-000000000000',
      organizationId: '11111111-1111-4111-8111-111111111111',
      quoteNumber: 'SQ-TX-1',
      status: 'sent',
      statusEntryId: null,
      validUntil: new Date(Date.now() + 60_000),
      updatedAt: new Date(),
    }

    let transactionalUsed = false
    mockEm.transactional = jest.fn(async (callback: (trx: any) => Promise<unknown>) => {
      transactionalUsed = true
      return callback(mockEm)
    }) as any

    mockEm.findOne.mockImplementation(async (cls: any) => {
      if (cls === SalesQuote) return quote
      if (cls === Dictionary) return { id: 'dict-1' }
      if (cls === DictionaryEntry) return { id: 'entry-confirmed' }
      if (cls === SalesOrder) return { id: 'order-tx-1', orderNumber: 'SO-TX-1', deletedAt: null }
      return null
    })
    mockCommandBus.execute.mockResolvedValue({ result: { orderId: 'order-tx-1' } })

    const res = await acceptQuote(makeAcceptRequest({ token: ACCEPTANCE_TOKEN }))
    expect(res.status).toBe(200)
    expect(transactionalUsed).toBe(true)
    expect(mockEm.findOne).not.toHaveBeenCalledWith(
      SalesQuote,
      expect.anything(),
      expect.not.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE })
    )
  })
})
