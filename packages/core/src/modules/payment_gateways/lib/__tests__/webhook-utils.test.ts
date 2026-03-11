import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { claimWebhookProcessing, releaseWebhookClaim } from '../webhook-utils'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

const { findOneWithDecryption } = jest.requireMock('@open-mercato/shared/lib/encryption/find') as {
  findOneWithDecryption: jest.Mock
}

function makeUniqueConstraintError(): UniqueConstraintViolationException {
  const error = new UniqueConstraintViolationException(
    new Error('duplicate key value violates unique constraint "gateway_webhook_events_idempotency_unique"'),
  )
  ;(error as unknown as Record<string, unknown>).constraint = 'gateway_webhook_events_idempotency_unique'
  return error
}

describe('payment gateway webhook utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('claims a webhook only once when the unique constraint is hit', async () => {
    const record = { id: 'evt_1' }
    const em = {
      create: jest.fn().mockReturnValue(record),
      persistAndFlush: jest.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(makeUniqueConstraintError()),
    }

    await expect(
      claimWebhookProcessing(
        em as never,
        'evt_1',
        'stripe',
        { organizationId: 'org_1', tenantId: 'tenant_1' },
        'payment_intent.succeeded',
      ),
    ).resolves.toBe(true)

    await expect(
      claimWebhookProcessing(
        em as never,
        'evt_1',
        'stripe',
        { organizationId: 'org_1', tenantId: 'tenant_1' },
        'payment_intent.succeeded',
      ),
    ).resolves.toBe(false)
  })

  it('releases a webhook claim when processing fails', async () => {
    const record = { id: 'evt_1' }
    findOneWithDecryption.mockResolvedValue(record)

    const em = {
      removeAndFlush: jest.fn().mockResolvedValue(undefined),
    }

    await releaseWebhookClaim(
      em as never,
      'evt_1',
      'stripe',
      { organizationId: 'org_1', tenantId: 'tenant_1' },
    )

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      {
        idempotencyKey: 'evt_1',
        providerKey: 'stripe',
        organizationId: 'org_1',
        tenantId: 'tenant_1',
      },
      undefined,
      { organizationId: 'org_1', tenantId: 'tenant_1' },
    )
    expect(em.removeAndFlush).toHaveBeenCalledWith(record)
  })
})
