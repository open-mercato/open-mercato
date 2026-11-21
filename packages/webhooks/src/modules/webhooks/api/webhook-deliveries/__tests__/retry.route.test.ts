/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const deliveryId = '33333333-3333-4333-8333-333333333333'
const webhookId = '44444444-4444-4444-8444-444444444444'

type DeliveryRow = {
  id: string
  webhookId: string
  tenantId: string
  organizationId: string
  status: string
  lastAttemptAt: Date | null
  nextRetryAt: Date | null
  errorMessage: string | null
  updatedAt: Date
  [key: string]: unknown
}

type BranchCondition = { status: string | { $ne: string }; lastAttemptAt?: null | { $lt: Date } }

const state: { delivery: DeliveryRow | null } = { delivery: null }

function matchesBranch(row: DeliveryRow, branch: BranchCondition): boolean {
  if (typeof branch.status === 'string') {
    if (row.status !== branch.status) return false
  } else if (row.status === branch.status.$ne) {
    return false
  }
  if (!('lastAttemptAt' in branch)) return true
  if (branch.lastAttemptAt === null) return row.lastAttemptAt === null
  return row.lastAttemptAt !== null && row.lastAttemptAt.getTime() < branch.lastAttemptAt!.$lt.getTime()
}

const nativeUpdate = jest.fn(async (_entity: unknown, where: { id: string; $or: BranchCondition[] }) => {
  const row = state.delivery
  if (!row || row.id !== where.id) return 0
  return where.$or.some((branch) => matchesBranch(row, branch)) ? 1 : 0
})

const em = { fork: () => em, nativeUpdate, flush: jest.fn(async () => undefined) }

jest.mock('../../helpers', () => {
  const actual = jest.requireActual('../../helpers')
  return {
    ...actual,
    resolveWebhookRequestScope: jest.fn(async () => ({
      em,
      tenantId,
      organizationId,
      allowedOrganizationIds: null,
    })),
    findScopedDelivery: jest.fn(async () => state.delivery),
  }
})

jest.mock('../../../lib/integration-state', () => ({
  isWebhookIntegrationEnabled: jest.fn(async () => true),
  WEBHOOK_INTEGRATION_DISABLED_MESSAGE: 'disabled',
}))

jest.mock('../../../lib/queue', () => ({
  enqueueWebhookDelivery: jest.fn(async () => 'job-1'),
  enqueueWebhookDeliveryFromJob: jest.fn(async () => 'job-2'),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(async () => ({ id: webhookId, timeoutMs: 5000 })),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback: string) => fallback,
  }),
}))

import { enqueueWebhookDelivery } from '../../../lib/queue'
import { POST } from '../[id]/retry/route'

const enqueueMock = enqueueWebhookDelivery as jest.MockedFunction<typeof enqueueWebhookDelivery>

function buildDelivery(overrides: Partial<DeliveryRow>): DeliveryRow {
  const now = new Date()
  return {
    id: deliveryId,
    webhookId,
    eventType: 'customers.person.created',
    messageId: 'msg_1',
    payload: {},
    status: 'failed',
    responseStatus: null,
    errorMessage: 'HTTP 500',
    attemptNumber: 1,
    maxAttempts: 3,
    targetUrl: 'https://example.com/hook',
    durationMs: null,
    enqueuedAt: now,
    lastAttemptAt: now,
    deliveredAt: null,
    nextRetryAt: null,
    tenantId,
    organizationId,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function callRetry(): Promise<Response> {
  return POST(new Request(`http://localhost/api/webhooks/deliveries/${deliveryId}/retry`, { method: 'POST' }), {
    params: Promise.resolve({ id: deliveryId }),
  })
}

describe('POST /api/webhooks/deliveries/{id}/retry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    state.delivery = null
  })

  it('answers 409 and never enqueues a delivery that is still being sent', async () => {
    state.delivery = buildDelivery({ status: 'sending', lastAttemptAt: new Date(), errorMessage: null })

    const response = await callRetry()

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: expect.stringContaining('currently being sent') })
    expect(enqueueMock).not.toHaveBeenCalled()
    expect(state.delivery.status).toBe('sending')
    expect(nativeUpdate).toHaveBeenCalledTimes(1)
  })

  it('re-enqueues a sending delivery whose lease has expired', async () => {
    state.delivery = buildDelivery({ status: 'sending', lastAttemptAt: new Date(Date.now() - 60 * 60 * 1000) })

    const response = await callRetry()

    expect(response.status).toBe(200)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
  })

  it('resets and re-enqueues a failed delivery', async () => {
    state.delivery = buildDelivery({ status: 'failed', nextRetryAt: new Date() })

    const response = await callRetry()

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ success: true, delivery: { id: deliveryId, status: 'pending', nextRetryAt: null, errorMessage: null } })
    expect(enqueueMock).toHaveBeenCalledWith({ deliveryId, tenantId, organizationId })
  })
})
