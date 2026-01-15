/** @jest-environment node */
import { POST as sendQuote } from '@open-mercato/core/modules/sales/api/quotes/send/route'
import { GET as getPublicQuote } from '@open-mercato/core/modules/sales/api/quotes/public/[token]/route'
import { POST as acceptQuote } from '@open-mercato/core/modules/sales/api/quotes/accept/route'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { Dictionary, DictionaryEntry } from '@open-mercato/core/modules/dictionaries/data/entities'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const mockCommandBus = { execute: jest.fn() }
const mockEm = {
  fork: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  persist: jest.fn(),
  flush: jest.fn(),
}

jest.mock('@/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn(),
}))

jest.mock('@/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (token: string) => {
      if (token === 'commandBus') return mockCommandBus
      if (token === 'em') return mockEm
      if (token === 'accessLogService') return null
      return null
    },
  })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn().mockResolvedValue({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  }),
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

describe('quote send + accept flow', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    const { getAuthFromRequest } = await import('@/lib/auth/server')
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
    expect(quote.validUntil).toBeInstanceOf(Date)
    expect(mockEm.flush).toHaveBeenCalled()
  })

  test('public view returns expired flag', async () => {
    const quote = {
      id: 'q-1',
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

    const res = await acceptQuote(makeRequest({ token: '00000000-0000-4000-8000-000000000000' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.orderId).toBe('order-1')
    expect(quote.status).toBe('confirmed')
    expect(mockCommandBus.execute).toHaveBeenCalledWith(
      'sales.quotes.convert_to_order',
      expect.objectContaining({ input: { quoteId: quote.id } })
    )
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


