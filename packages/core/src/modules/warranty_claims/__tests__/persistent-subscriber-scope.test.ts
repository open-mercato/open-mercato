const TRUSTED_TENANT_ID = '11111111-1111-4111-8111-111111111111'
const TRUSTED_ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const HOSTILE_TENANT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const HOSTILE_ORGANIZATION_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const reconcileVendorRecoverySourceClaimMock = jest.fn(async () => undefined)
const createNotificationMock = jest.fn(async () => ({}))
const createBatchNotificationMock = jest.fn(async () => [])
const createForFeatureNotificationMock = jest.fn(async () => [])
const resolveNotificationServiceMock = jest.fn(() => ({
  create: createNotificationMock,
  createBatch: createBatchNotificationMock,
  createForFeature: createForFeatureNotificationMock,
}))
const buildNotificationFromTypeMock = jest.fn((_type: unknown, input: unknown) => input)
const buildBatchNotificationFromTypeMock = jest.fn((_type: unknown, input: unknown) => input)
const buildFeatureNotificationFromTypeMock = jest.fn((_type: unknown, input: unknown) => input)
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('../commands/shared', () => ({
  reconcileVendorRecoverySourceClaim: (...args: unknown[]) => reconcileVendorRecoverySourceClaimMock(...args),
}))

jest.mock('../../notifications/lib/notificationService', () => ({
  resolveNotificationService: (...args: unknown[]) => resolveNotificationServiceMock(...args),
}))

jest.mock('../../notifications/lib/notificationBuilder', () => ({
  buildNotificationFromType: (...args: unknown[]) => buildNotificationFromTypeMock(...args),
  buildBatchNotificationFromType: (...args: unknown[]) => buildBatchNotificationFromTypeMock(...args),
  buildFeatureNotificationFromType: (...args: unknown[]) => buildFeatureNotificationFromTypeMock(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

import handleAssigned from '../subscribers/claim-assigned-notification'
import handleCustomerReply from '../subscribers/claim-customer-reply-notification'
import handleStatus from '../subscribers/claim-status-notification'
import handleSubmitted from '../subscribers/claim-submitted-notification'
import handleVendorRecovery from '../subscribers/vendor-recovery-reconciliation'
import handleVendorRecoveryUndo from '../subscribers/vendor-recovery-reconciliation-undo'

const hostilePayloadScope = {
  tenantId: HOSTILE_TENANT_ID,
  organizationId: HOSTILE_ORGANIZATION_ID,
}

function makeContext(includeTrustedScope = true) {
  const entityManager = { fork: () => ({}) }
  const resolve = <T = unknown>(name: string): T => {
    if (name === 'em') return entityManager as T
    throw new Error(`Unexpected dependency: ${name}`)
  }
  return {
    resolve,
    container: { resolve },
    tenantId: includeTrustedScope ? TRUSTED_TENANT_ID : null,
    organizationId: includeTrustedScope ? TRUSTED_ORGANIZATION_ID : null,
  }
}

describe('warranty_claims persistent subscriber trusted scope', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    findOneWithDecryptionMock.mockResolvedValue({
      id: 'claim-1',
      claimNumber: 'WC-1',
      assigneeUserId: 'assignee-1',
    })
    findWithDecryptionMock.mockResolvedValue([{ kind: 'system', payload: { action: 'created' }, actorUserId: 'creator-1' }])
  })

  it('reconciles vendor recovery only inside trusted context scope', async () => {
    const payload = {
      claimId: 'recovery-1',
      claimType: 'vendor_recovery',
      toStatus: 'resolved',
      ...hostilePayloadScope,
    }

    await handleVendorRecovery(payload, makeContext())
    await handleVendorRecoveryUndo(payload, makeContext())

    expect(reconcileVendorRecoverySourceClaimMock).toHaveBeenNthCalledWith(1, expect.any(Object), {
      claimId: 'recovery-1',
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
    expect(reconcileVendorRecoverySourceClaimMock).toHaveBeenNthCalledWith(2, expect.any(Object), {
      claimId: 'recovery-1',
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
  })

  it('loads status and customer-reply claims with trusted scope and preserves idempotency keys', async () => {
    const context = makeContext()
    await handleStatus({
      claimId: 'claim-1',
      claimNumber: 'WC-1',
      fromStatus: 'submitted',
      toStatus: 'approved',
      ...hostilePayloadScope,
    }, context)
    await handleCustomerReply({
      claimId: 'claim-1',
      actorCustomerId: 'customer-1',
      ...hostilePayloadScope,
    }, context)

    expect(findOneWithDecryptionMock).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      { id: 'claim-1', tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID, deletedAt: null },
      {},
      { tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID },
    )
    expect(findOneWithDecryptionMock).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.anything(),
      { id: 'claim-1', tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID, deletedAt: null },
      {},
      { tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID },
    )
    expect(findWithDecryptionMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { claim: 'claim-1', tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID },
      { orderBy: { createdAt: 'asc' }, limit: 25 },
      { tenantId: TRUSTED_TENANT_ID, organizationId: TRUSTED_ORGANIZATION_ID },
    )
    expect(buildBatchNotificationFromTypeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupKey: 'warranty_claims.claim.status_changed:claim-1:approved',
    }))
    expect(buildNotificationFromTypeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupKey: 'warranty_claims.claim.customer_replied:claim-1:assignee-1',
    }))
    expect(createBatchNotificationMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
  })

  it('creates assigned and submitted notifications in trusted scope with stable group keys', async () => {
    const context = makeContext()
    await handleAssigned({
      claimId: 'claim-1',
      claimNumber: 'WC-1',
      assigneeUserId: 'assignee-1',
      ...hostilePayloadScope,
    }, context)
    await handleSubmitted({ claimId: 'claim-1', claimNumber: 'WC-1', ...hostilePayloadScope }, context)

    expect(buildNotificationFromTypeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupKey: 'warranty_claims.claim.assigned:claim-1:assignee-1',
    }))
    expect(buildFeatureNotificationFromTypeMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      groupKey: 'warranty_claims.claim.submitted:claim-1',
    }))
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
    expect(createForFeatureNotificationMock).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TRUSTED_TENANT_ID,
      organizationId: TRUSTED_ORGANIZATION_ID,
    })
  })

  it('fails closed for every handler when trusted context scope is absent', async () => {
    const context = makeContext(false)
    const payload = {
      claimId: 'claim-1',
      claimType: 'vendor_recovery',
      toStatus: 'resolved',
      actorCustomerId: 'customer-1',
      assigneeUserId: 'assignee-1',
      ...hostilePayloadScope,
    }

    await handleVendorRecovery(payload, context)
    await handleVendorRecoveryUndo(payload, context)
    await handleStatus(payload, context)
    await handleCustomerReply(payload, context)
    await handleAssigned(payload, context)
    await handleSubmitted(payload, context)

    expect(reconcileVendorRecoverySourceClaimMock).not.toHaveBeenCalled()
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(resolveNotificationServiceMock).not.toHaveBeenCalled()
  })
})
