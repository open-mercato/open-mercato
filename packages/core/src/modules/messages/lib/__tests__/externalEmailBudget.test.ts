import { NextResponse } from 'next/server'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'

const checkRateLimitMock = jest.fn()
const withAdvisoryXactLockMock = jest.fn()

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/ratelimit/helpers'),
  checkRateLimit: (...args: unknown[]) => checkRateLimitMock(...args),
}))

jest.mock('@open-mercato/shared/lib/db/advisoryLock', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/db/advisoryLock'),
  withAdvisoryXactLock: (...args: unknown[]) => withAdvisoryXactLockMock(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    t: (_key: string, fallback: string) => fallback,
  }),
}))

import { checkExternalEmailBudget } from '../externalEmailBudget'

const tenantId = '7fb7fe47-ddf6-4f65-b5ae-b08e2df2fdb7'
const userId = '5be8e4d6-14d2-4352-8f55-b95f95fd9205'
const now = new Date('2026-11-11T12:00:00.000Z')

type LedgerRow = {
  id: string
  tenantId: string
  utcDay: string
  recipientHash: string
  createdAt: Date
}

function createContext(options: {
  configuredLimit?: number | null
  tenantCreatedAt?: string
  existingRecipients?: number
  missingService?: string
  rows?: LedgerRow[]
  tenantId?: string
} = {}) {
  const scopedTenantId = options.tenantId ?? tenantId
  const rows: LedgerRow[] = options.rows ?? Array.from({ length: options.existingRecipients ?? 0 }, (_, index) => ({
    id: `existing-${index}`,
    tenantId: scopedTenantId,
    utcDay: '2026-11-11',
    recipientHash: `existing-hash-${index}`,
    createdAt: now,
  }))
  const tenantCreatedAt = options.tenantCreatedAt ?? '2020-01-01T00:00:00.000Z'
  const db = {
    selectFrom: (table: string) => {
      const filters = new Map<string, unknown>()
      let countQuery = false
      const query = {
        select: (selection: unknown) => {
          countQuery = typeof selection !== 'string'
          return query
        },
        where: (column: string, _operator: string, value: unknown) => {
          filters.set(column, value)
          return query
        },
        executeTakeFirst: async () => {
          if (table === 'tenants') {
            return filters.get('id') === scopedTenantId ? { created_at: tenantCreatedAt } : undefined
          }
          const matching = rows.filter((row) =>
            (!filters.has('tenant_id') || row.tenantId === filters.get('tenant_id')) &&
            (!filters.has('utc_day') || row.utcDay === filters.get('utc_day')) &&
            (!filters.has('recipient_hash') || row.recipientHash === filters.get('recipient_hash')),
          )
          if (countQuery) return { count: String(matching.length) }
          return matching[0] ? { id: matching[0].id } : undefined
        },
      }
      return query
    },
  }
  const em = {
    getKysely: () => db,
    create: (_entity: unknown, input: LedgerRow) => input,
    persist: (row: LedgerRow) => ({
      flush: async () => {
        rows.push(row)
      },
    }),
  }
  const container = {
    resolve: (name: string) => {
      if (name === options.missingService) throw new Error('[internal] missing test service')
      if (name === 'rateLimiterService') return { consume: jest.fn() }
      if (name === 'em') return em
      if (name === 'moduleConfigService') {
        return { getValue: jest.fn(async () => options.configuredLimit ?? null) }
      }
      throw new Error(`[internal] unexpected test service: ${name}`)
    },
  }
  return { container, em, rows }
}

async function check(
  context: ReturnType<typeof createContext>,
  externalEmail = 'recipient@example.com',
  checkNow = now,
  scopeTenantId = tenantId,
) {
  return checkExternalEmailBudget(
    context.container,
    { tenantId: scopeTenantId, userId },
    externalEmail,
    { now: checkNow },
  )
}

describe('checkExternalEmailBudget', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    checkRateLimitMock.mockResolvedValue(null)
    const lockTails = new Map<string, Promise<void>>()
    withAdvisoryXactLockMock.mockImplementation((em, key, callback) => {
      const previous = lockTails.get(key) ?? Promise.resolve()
      const result = previous.then(() => callback(em))
      lockTails.set(key, result.then(() => undefined, () => undefined))
      return result
    })
  })

  it('applies independent per-user and per-tenant buckets before reserving the recipient', async () => {
    const context = createContext({ configuredLimit: 5 })

    await expect(check(context)).resolves.toBeNull()

    expect(checkRateLimitMock).toHaveBeenCalledTimes(2)
    expect(checkRateLimitMock.mock.calls[0][1]).toMatchObject({
      points: 20,
      duration: 3600,
      keyPrefix: 'messages_external_user',
    })
    expect(checkRateLimitMock.mock.calls[0][2]).toBe(`${tenantId}:${userId}`)
    expect(checkRateLimitMock.mock.calls[1][1]).toMatchObject({
      points: 100,
      duration: 3600,
      keyPrefix: 'messages_external_tenant',
    })
    expect(checkRateLimitMock.mock.calls[1][2]).toBe(tenantId)
    expect(checkRateLimitMock.mock.calls[0][4]).toMatchObject({ failClosed: true })
    expect(context.rows).toHaveLength(1)
    expect(context.rows[0].recipientHash).toBe(hashForLookup('recipient@example.com', 'messages.external_recipient'))
  })

  it.each(['user', 'tenant'])('stops when the %s bucket is exhausted', async (bucket) => {
    const context = createContext({ configuredLimit: 5 })
    const limited = NextResponse.json({ error: 'limited' }, { status: 429 })
    if (bucket === 'tenant') checkRateLimitMock.mockResolvedValueOnce(null)
    checkRateLimitMock.mockResolvedValueOnce(limited)

    await expect(check(context)).resolves.toBe(limited)

    expect(withAdvisoryXactLockMock).not.toHaveBeenCalled()
    expect(context.rows).toHaveLength(0)
  })

  it('does not consume another daily slot for a normalized repeat recipient', async () => {
    const context = createContext({ configuredLimit: 1 })

    await expect(check(context, ' Recipient@Example.com ')).resolves.toBeNull()
    await expect(check(context, 'recipient@example.com')).resolves.toBeNull()

    expect(context.rows).toHaveLength(1)
  })

  it('rejects a new recipient beyond the configured daily cap', async () => {
    const context = createContext({ configuredLimit: 1 })

    await expect(check(context, 'first@example.com')).resolves.toBeNull()
    const response = await check(context, 'second@example.com')

    expect(response?.status).toBe(429)
    expect(await response?.json()).toEqual({ error: 'Daily external recipient limit reached. Try again tomorrow.' })
    expect(response?.headers.get('Retry-After')).toBe('43200')
    expect(context.rows).toHaveLength(1)
  })

  it('serializes concurrent admissions so they cannot exceed the daily cap', async () => {
    const context = createContext({ configuredLimit: 1 })

    const responses = await Promise.all([
      check(context, 'first@example.com'),
      check(context, 'second@example.com'),
    ])

    expect(responses.map((response) => response?.status ?? 201).sort()).toEqual([201, 429])
    expect(context.rows).toHaveLength(1)
  })

  it('keeps daily recipient ledgers isolated by tenant', async () => {
    const otherTenantId = 'ec52dcf7-e8aa-4f2c-8b0d-32725a2e89e1'
    const rows: LedgerRow[] = []
    const firstTenant = createContext({ configuredLimit: 1, rows })
    const otherTenant = createContext({ configuredLimit: 1, rows, tenantId: otherTenantId })

    await expect(check(firstTenant)).resolves.toBeNull()
    await expect(check(otherTenant, 'recipient@example.com', now, otherTenantId)).resolves.toBeNull()

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.tenantId).sort()).toEqual([otherTenantId, tenantId].sort())
  })

  it('uses a lower default for newly created tenants', async () => {
    const recent = createContext({
      existingRecipients: 20,
      tenantCreatedAt: '2026-11-01T00:00:00.000Z',
    })
    const established = createContext({
      existingRecipients: 20,
      tenantCreatedAt: '2026-01-01T00:00:00.000Z',
    })

    const recentResponse = await check(recent)
    await expect(check(established)).resolves.toBeNull()

    expect(recentResponse?.status).toBe(429)
    expect(recent.rows).toHaveLength(20)
    expect(established.rows).toHaveLength(21)
  })

  it('starts a fresh daily ledger at UTC midnight', async () => {
    const context = createContext({ configuredLimit: 1 })

    await expect(check(context)).resolves.toBeNull()
    await expect(check(context, 'recipient@example.com', new Date('2026-11-12T00:00:00.000Z'))).resolves.toBeNull()

    expect(context.rows.map((row) => row.utcDay)).toEqual(['2026-11-11', '2026-11-12'])
  })

  it('fails closed when required enforcement services are unavailable', async () => {
    const context = createContext({ missingService: 'rateLimiterService' })

    const response = await check(context)

    expect(response?.status).toBe(503)
    expect(checkRateLimitMock).not.toHaveBeenCalled()
    expect(context.rows).toHaveLength(0)
  })

  it('fails closed when the recipient ledger lock cannot be acquired', async () => {
    const context = createContext({ configuredLimit: 1 })
    withAdvisoryXactLockMock.mockRejectedValue(
      new AdvisoryLockUnavailableError('deadline', 'messages_external_recipient:test'),
    )

    const response = await check(context)

    expect(response?.status).toBe(503)
    expect(context.rows).toHaveLength(0)
  })
})
