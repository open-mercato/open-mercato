/**
 * Unit tests for `customers.analyze_deals` and the pure scoring helpers.
 *
 * The handler is exercised end-to-end with a mocked `em` and a mocked
 * `findWithDecryption` to prove:
 *   - tenant + organization scoping is applied to every read
 *   - the encrypted CustomerActivity / CustomerEntity reads go through
 *     `findWithDecryption` (regression guard for the encryption-helper
 *     downgrade caught in PR #1871 review)
 *   - the health-score ranking + stalled-count math is correct
 */
const findWithDecryptionMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const loadCustomFieldValuesMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: (...args: unknown[]) => loadCustomFieldValuesMock(...args),
}))

import dealAnalyzerAiTools, {
  computeHealthScore,
  msTodays,
} from '../../ai-tools/deal-analyzer-pack'
import {
  CustomerDeal,
  CustomerActivity,
  CustomerDealPersonLink,
  CustomerEntity,
} from '../../data/entities'
import { knownFeatureIds, makeCtx } from './shared'

function findTool(name: string) {
  const tool = dealAnalyzerAiTools.find((entry) => entry.name === name)
  if (!tool) throw new Error(`tool ${name} missing`)
  return tool
}

describe('computeHealthScore', () => {
  it('returns 100 for days = 0', () => {
    expect(computeHealthScore(0)).toBe(100)
  })

  it('returns 0 for days >= 30', () => {
    expect(computeHealthScore(30)).toBe(0)
    expect(computeHealthScore(60)).toBe(0)
    expect(computeHealthScore(1000)).toBe(0)
  })

  it('decays linearly between 0 and 30 days', () => {
    expect(computeHealthScore(15)).toBe(50)
    expect(computeHealthScore(6)).toBeCloseTo(80, 5)
    expect(computeHealthScore(24)).toBeCloseTo(20, 5)
  })

  it('clamps negative inputs to 100 (defensive)', () => {
    expect(computeHealthScore(-1)).toBe(100)
  })
})

describe('msTodays', () => {
  it('converts whole days', () => {
    expect(msTodays(86_400_000)).toBe(1)
    expect(msTodays(86_400_000 * 7)).toBe(7)
  })

  it('floors partial days', () => {
    expect(msTodays(86_400_000 + 60_000)).toBe(1)
    expect(msTodays(86_400_000 - 1)).toBe(0)
  })

  it('returns 0 for zero/negative input', () => {
    expect(msTodays(0)).toBe(0)
    expect(msTodays(-1000)).toBe(-1)
  })
})

describe('customers.analyze_deals tool definition', () => {
  const tool = findTool('customers.analyze_deals')

  it('declares existing RBAC features and is not a mutation', () => {
    expect(tool.requiredFeatures).toContain('customers.deals.view')
    for (const feature of tool.requiredFeatures!) {
      expect(knownFeatureIds.has(feature)).toBe(true)
    }
    expect(tool.isMutation).toBeFalsy()
    expect(tool.tags).toEqual(expect.arrayContaining(['read', 'customers', 'analytics']))
  })

  it('enforces input bounds on limit and daysOfActivityWindow', () => {
    const schema = tool.inputSchema as { parse: (input: unknown) => unknown }
    expect(() => schema.parse({ limit: 0 })).toThrow()
    expect(() => schema.parse({ limit: 101 })).toThrow()
    expect(() => schema.parse({ daysOfActivityWindow: 0 })).toThrow()
    expect(() => schema.parse({ daysOfActivityWindow: 366 })).toThrow()
  })
})

describe('customers.analyze_deals handler', () => {
  const tool = findTool('customers.analyze_deals')
  const NOW = new Date('2026-05-08T12:00:00Z').getTime()

  function makeDeal(overrides: Partial<{ id: string; title: string; status: string; pipelineStage: string | null; valueAmount: string; valueCurrency: string }> = {}) {
    return {
      id: overrides.id ?? '00000000-0000-0000-0000-000000000001',
      title: overrides.title ?? 'Untitled deal',
      status: overrides.status ?? 'open',
      pipelineStage: overrides.pipelineStage ?? 'Qualification',
      valueAmount: overrides.valueAmount ?? '10000',
      valueCurrency: overrides.valueCurrency ?? 'USD',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
  }

  beforeEach(() => {
    findWithDecryptionMock.mockReset()
    jest.spyOn(Date, 'now').mockReturnValue(NOW)
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns empty result when no deals match', async () => {
    findWithDecryptionMock.mockResolvedValueOnce([]) // deals
    const ctx = makeCtx()
    const result = (await tool.handler({ daysOfActivityWindow: 30 }, ctx as any)) as {
      deals: unknown[]
      totalAnalyzed: number
      stalledCount: number
      windowDays: number
    }
    expect(result.deals).toEqual([])
    expect(result.totalAnalyzed).toBe(0)
    expect(result.stalledCount).toBe(0)
    expect(result.windowDays).toBe(30)
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
    expect(findWithDecryptionMock.mock.calls[0][1]).toBe(CustomerDeal)
  })

  it('routes activity reads through findWithDecryption (encryption regression guard)', async () => {
    const deal = makeDeal({ id: 'deal-1', title: 'Deal A' })
    findWithDecryptionMock
      .mockResolvedValueOnce([deal]) // deals
      .mockResolvedValueOnce([
        {
          deal: { id: 'deal-1' },
          occurredAt: new Date(NOW - 5 * 86_400_000),
          createdAt: new Date(NOW - 5 * 86_400_000),
        },
      ]) // activities

    // No person links → skips the CustomerEntity decryption call entirely.
    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') {
        return {
          find: jest.fn().mockResolvedValue([]),
          count: jest.fn().mockResolvedValue(0),
        }
      }
      throw new Error(`unexpected resolve: ${name}`)
    })

    await tool.handler({}, ctx as any)

    expect(findWithDecryptionMock).toHaveBeenCalledTimes(2)
    expect(findWithDecryptionMock.mock.calls[0][1]).toBe(CustomerDeal)
    expect(findWithDecryptionMock.mock.calls[1][1]).toBe(CustomerActivity)
    // Tenant + organization scope must be carried into both decryption calls.
    const activityScope = findWithDecryptionMock.mock.calls[1][4]
    expect(activityScope).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('decrypts person names via CustomerEntity, never via populated relation', async () => {
    const deal = makeDeal({ id: 'deal-1', title: 'Deal A' })
    const personLink = {
      id: 'link-1',
      deal: { id: 'deal-1' },
      person: { id: 'person-1' },
    }
    const person = {
      id: 'person-1',
      displayName: 'Alice Plaintext',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    }
    findWithDecryptionMock
      .mockResolvedValueOnce([deal]) // deals
      .mockResolvedValueOnce([]) // activities
      .mockResolvedValueOnce([person]) // CustomerEntity decrypted

    const findMock = jest.fn().mockResolvedValue([personLink])
    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') return { find: findMock, count: jest.fn().mockResolvedValue(0) }
      throw new Error(`unexpected resolve: ${name}`)
    })

    const result = (await tool.handler({}, ctx as any)) as { deals: Array<{ primaryContact: string | null }> }

    expect(findMock).toHaveBeenCalledTimes(1)
    expect(findMock.mock.calls[0][0]).toBe(CustomerDealPersonLink)
    expect(findMock.mock.calls[0][1]).toEqual({ deal: { $in: ['deal-1'] } })
    const findOptions = findMock.mock.calls[0][2] ?? {}
    expect((findOptions as { populate?: unknown }).populate).toBeUndefined()
    // Third decryption call resolves person names.
    expect(findWithDecryptionMock.mock.calls[2][1]).toBe(CustomerEntity)
    expect(result.deals[0].primaryContact).toBe('Alice Plaintext')
  })

  it('ranks most-at-risk first and counts stalled deals against the window', async () => {
    const dealHealthy = makeDeal({ id: 'deal-h', title: 'Fresh', valueAmount: '1000' })
    const dealStalled = makeDeal({ id: 'deal-s', title: 'Stalled', valueAmount: '50000' })
    const dealMid = makeDeal({ id: 'deal-m', title: 'Mid', valueAmount: '20000' })

    findWithDecryptionMock
      .mockResolvedValueOnce([dealHealthy, dealStalled, dealMid]) // deals
      .mockResolvedValueOnce([
        {
          deal: { id: 'deal-h' },
          occurredAt: new Date(NOW - 1 * 86_400_000),
          createdAt: new Date(NOW - 1 * 86_400_000),
        },
        {
          deal: { id: 'deal-m' },
          occurredAt: new Date(NOW - 15 * 86_400_000),
          createdAt: new Date(NOW - 15 * 86_400_000),
        },
        // deal-s has no activity → counted as fully stalled
      ])

    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') return { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
      throw new Error(`unexpected resolve: ${name}`)
    })

    const result = (await tool.handler({ daysOfActivityWindow: 30 }, ctx as any)) as {
      deals: Array<{ id: string; healthScore: number; daysSinceLastActivity: number; value: number | null }>
      stalledCount: number
      totalAnalyzed: number
      windowDays: number
    }

    expect(result.deals.map((d) => d.id)).toEqual(['deal-s', 'deal-m', 'deal-h'])
    expect(result.deals[0].healthScore).toBe(0)
    expect(result.deals[0].daysSinceLastActivity).toBe(30)
    expect(result.stalledCount).toBe(1)
    expect(result.totalAnalyzed).toBe(3)
    expect(result.windowDays).toBe(30)
  })

  it('breaks health-score ties by value desc', async () => {
    const lowValue = makeDeal({ id: 'low', title: 'Low value', valueAmount: '1000' })
    const highValue = makeDeal({ id: 'high', title: 'High value', valueAmount: '99000' })

    findWithDecryptionMock
      .mockResolvedValueOnce([lowValue, highValue])
      .mockResolvedValueOnce([]) // no activities → both stalled, same health score

    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') return { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
      throw new Error(`unexpected resolve: ${name}`)
    })

    const result = (await tool.handler({}, ctx as any)) as {
      deals: Array<{ id: string }>
    }

    expect(result.deals.map((d) => d.id)).toEqual(['high', 'low'])
  })

  it('respects the limit input (truncation after ranking)', async () => {
    const deals = Array.from({ length: 5 }, (_, idx) =>
      makeDeal({
        id: `deal-${idx}`,
        title: `Deal ${idx}`,
        valueAmount: String(1000 * (idx + 1)),
      }),
    )

    findWithDecryptionMock
      .mockResolvedValueOnce(deals)
      .mockResolvedValueOnce([]) // no activities

    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') return { find: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) }
      throw new Error(`unexpected resolve: ${name}`)
    })

    const result = (await tool.handler({ limit: 2 }, ctx as any)) as { deals: unknown[]; totalAnalyzed: number }
    expect(result.deals).toHaveLength(2)
    expect(result.totalAnalyzed).toBe(5)
  })

  it('applies tenantId + organizationId to scoped entity reads and link reads through scoped deal ids', async () => {
    findWithDecryptionMock
      .mockResolvedValueOnce([makeDeal({ id: 'deal-1' })])
      .mockResolvedValueOnce([])

    const findMock = jest.fn().mockResolvedValue([])
    const ctx = makeCtx()
    ;(ctx.container.resolve as jest.Mock).mockImplementation((name: string) => {
      if (name === 'em') return { find: findMock, count: jest.fn().mockResolvedValue(0) }
      throw new Error(`unexpected resolve: ${name}`)
    })

    await tool.handler({}, ctx as any)

    // deal where
    const dealWhere = findWithDecryptionMock.mock.calls[0][2]
    expect(dealWhere).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null })
    // activity where
    const activityWhere = findWithDecryptionMock.mock.calls[1][2]
    expect(activityWhere).toMatchObject({ tenantId: 'tenant-1', organizationId: 'org-1' })
    // person link where (raw em.find)
    expect(findMock).toHaveBeenCalledTimes(1)
    const personLinkWhere = findMock.mock.calls[0][1]
    expect(personLinkWhere).toEqual({ deal: { $in: ['deal-1'] } })
    expect(personLinkWhere).not.toHaveProperty('tenantId')
    expect(personLinkWhere).not.toHaveProperty('organizationId')
  })

  it('rejects calls with no tenant scope', async () => {
    const ctx = makeCtx({ tenantId: null })
    await expect(tool.handler({}, ctx as any)).rejects.toThrow()
  })
})
