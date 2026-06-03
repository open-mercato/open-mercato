/** @jest-environment node */

/**
 * Regression test for #2117 (audit finding C-03): the legacy activities deal
 * enrichment (decorateActivityItems) must hard-fail (400) when tenant/org scope
 * is missing instead of falling through to an unscoped em.find that could
 * decrypt foreign-tenant deal titles. The deal lookup must also scope its WHERE
 * clause by tenant + org.
 */

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('../../../lib/interactionFeatureFlags', () => ({
  resolveCustomerInteractionFeatureFlags: jest.fn(),
}))

jest.mock('../../../lib/interactionRequestContext', () => ({
  resolveCustomersRequestContext: jest.fn(),
}))

jest.mock('../../../lib/interactionReadModel', () => ({
  hydrateCanonicalInteractions: jest.fn(),
  loadCustomerSummaries: jest.fn(),
}))

jest.mock('../../../lib/interactionCompatibility', () => ({
  mapInteractionRecordToActivitySummary: jest.fn(),
  CUSTOMER_INTERACTION_ACTIVITY_ADAPTER_SOURCE: 'adapter:activity',
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

import { decorateActivityItems } from '../route'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { CustomerDeal } from '../../../data/entities'

const DEAL_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'

function makeItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'activity-1',
    activityType: 'call',
    createdAt: '2026-01-01T00:00:00.000Z',
    dealId: DEAL_ID,
    authorUserId: null,
    ...overrides,
  } as Parameters<typeof decorateActivityItems>[1][number]
}

describe('activities decorateActivityItems deal scope (#2117)', () => {
  beforeEach(() => {
    mockFindWithDecryption.mockReset()
  })

  it('throws 400 when scope is missing and a deal needs enrichment', async () => {
    const em = { find: jest.fn() }
    let caught: unknown
    try {
      await decorateActivityItems(em as never, [makeItem()], undefined)
    } catch (err) {
      caught = err
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(400)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('throws 400 when scope is missing its organization', async () => {
    const em = { find: jest.fn() }
    let caught: unknown
    try {
      await decorateActivityItems(em as never, [makeItem()], {
        tenantId: 'tenant-1',
      } as { tenantId: string; organizationId: string })
    } catch (err) {
      caught = err
    }

    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as { status: number }).status).toBe(400)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(em.find).not.toHaveBeenCalled()
  })

  it('scopes the deal lookup by tenant and organization in the WHERE clause', async () => {
    mockFindWithDecryption.mockResolvedValue([{ id: DEAL_ID, title: 'Acme expansion' }])
    const em = { find: jest.fn().mockResolvedValue([]) }

    const result = await decorateActivityItems(em as never, [makeItem()], {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      CustomerDeal,
      expect.objectContaining({
        id: { $in: [DEAL_ID] },
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
    expect(result[0].dealTitle).toBe('Acme expansion')
  })

  it('does not require scope when no item references a deal', async () => {
    const em = { find: jest.fn().mockResolvedValue([]) }

    const result = await decorateActivityItems(
      em as never,
      [makeItem({ dealId: null })],
      undefined,
    )

    expect(result).toHaveLength(1)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
  })
})
