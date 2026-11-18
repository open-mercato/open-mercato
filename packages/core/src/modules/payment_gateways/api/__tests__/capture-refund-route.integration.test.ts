/** @jest-environment node */

import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { GatewayTransaction } from '../../data/entities'
import { createPaymentGatewayService, type PaymentGatewayServiceDeps } from '../../lib/gateway-service'
import { runPaymentGatewayMutationGuardAfterSuccess } from '../guards'
import { POST as capturePayment } from '../capture/route'
import { POST as refundPayment } from '../refund/route'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('../guards', () => ({
  resolveUserFeatures: jest.fn(() => []),
  runPaymentGatewayMutationGuards: jest.fn(async () => ({ ok: true, afterSuccessCallbacks: [] })),
  runPaymentGatewayMutationGuardAfterSuccess: jest.fn(),
}))

const transactionId = '11111111-1111-4111-8111-111111111111'
const scope = { tenantId: 'tenant-1', organizationId: 'organization-1' }
const record = { id: transactionId, ...scope, deletedAt: null }
const findOneMock = jest.mocked(findOneWithDecryption)

const invisibleRecords = [
  { name: 'unknown', record: { ...record, id: 'another-transaction' } },
  { name: 'cross-tenant', record: { ...record, tenantId: 'another-tenant' } },
  { name: 'cross-organization', record: { ...record, organizationId: 'another-organization' } },
  { name: 'soft-deleted', record: { ...record, deletedAt: new Date() } },
]

describe.each([
  { action: 'capture', handler: capturePayment },
  { action: 'refund', handler: refundPayment },
])('$action route with the real payment gateway service lookup', ({ action, handler }) => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(getAuthFromRequest).mockResolvedValue({
      sub: 'user-1', tenantId: scope.tenantId, orgId: scope.organizationId,
    })
  })

  it.each(invisibleRecords)('returns 404 for a $name transaction without resolving provider credentials', async ({ record: storedRecord }) => {
    findOneMock.mockImplementation(async (_manager, _entity, where) => {
      const matches = Object.entries(where).every(([key, value]) => (
        storedRecord[key as keyof typeof storedRecord] === value
      ))
      return matches ? storedRecord as GatewayTransaction : null
    })
    const resolveCredentials = jest.fn()
    const service = createPaymentGatewayService({
      em: {} as PaymentGatewayServiceDeps['em'],
      integrationCredentialsService: { resolve: resolveCredentials } as unknown as PaymentGatewayServiceDeps['integrationCredentialsService'],
    })
    jest.mocked(createRequestContainer).mockResolvedValue({
      resolve: () => service,
    } as unknown as Awaited<ReturnType<typeof createRequestContainer>>)

    const response = await handler(new Request(`http://localhost/api/payment_gateways/${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ transactionId, amount: 1 }),
    }))

    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: 'Transaction not found' })
    expect(findOneMock).toHaveBeenCalledWith(
      expect.anything(),
      GatewayTransaction,
      { id: transactionId, ...scope, deletedAt: null },
      undefined,
      scope,
    )
    expect(resolveCredentials).not.toHaveBeenCalled()
    expect(runPaymentGatewayMutationGuardAfterSuccess).not.toHaveBeenCalled()
  })
})
