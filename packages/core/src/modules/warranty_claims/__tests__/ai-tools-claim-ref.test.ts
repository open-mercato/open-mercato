import type { AwilixContainer } from 'awilix'
import { aiTools, type WarrantyClaimsToolContext } from '../ai-tools'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_UUID = '33333333-3333-4333-8333-333333333333'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

function buildClaim() {
  return {
    id: CLAIM_UUID,
    claimNumber: 'WTY-000005',
    claimType: 'warranty',
    status: 'draft',
    priority: 'normal',
    customerId: null,
    customerName: null,
    orderId: null,
    assigneeUserId: null,
    updatedAt: null,
    channel: 'staff',
    vendorName: null,
    vendorRef: null,
    salesReturnId: null,
    replacementOrderId: null,
    sourceClaimId: null,
    advanceReplacement: false,
    reasonCode: null,
    rejectionReasonCode: null,
    resolutionSummary: null,
    currencyCode: null,
    totalClaimedAmount: null,
    totalApprovedAmount: null,
    totalRecoveredAmount: null,
    slaDueAt: null,
    submittedAt: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: null,
  }
}

function buildContext(): WarrantyClaimsToolContext {
  const container = { resolve: () => ({}) } as unknown as AwilixContainer
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: 'user-1',
    container,
    userFeatures: ['warranty_claims.claim.view'],
    isSuperAdmin: false,
  }
}

const getClaimTool = aiTools.find((tool) => tool.name === 'warranty_claims.get_claim')!

beforeEach(() => {
  findOneWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockReset()
  findWithDecryptionMock.mockResolvedValue([])
})

describe('warranty_claims.get_claim claim-ref resolution', () => {
  it('resolves a human-readable claim number to the claim', async () => {
    const claim = buildClaim()
    findOneWithDecryptionMock.mockResolvedValue(claim)

    const result = (await getClaimTool.handler({ claimId: 'WTY-000005' }, buildContext())) as {
      found: boolean
      claim?: { claimNumber: string }
    }

    expect(result.found).toBe(true)
    expect(result.claim?.claimNumber).toBe('WTY-000005')
    const filters = findOneWithDecryptionMock.mock.calls.map((call) => call[2])
    expect(filters.some((filter) => filter && filter.claimNumber === 'WTY-000005')).toBe(true)
  })

  it('accepts a UUID directly without a claim-number lookup', async () => {
    const claim = buildClaim()
    findOneWithDecryptionMock.mockResolvedValue(claim)

    const result = (await getClaimTool.handler({ claimId: CLAIM_UUID }, buildContext())) as { found: boolean }

    expect(result.found).toBe(true)
    const filters = findOneWithDecryptionMock.mock.calls.map((call) => call[2])
    expect(filters.every((filter) => !(filter && 'claimNumber' in filter))).toBe(true)
  })

  it('returns found: false for an unknown claim number', async () => {
    findOneWithDecryptionMock.mockResolvedValue(null)

    const result = (await getClaimTool.handler({ claimId: 'WTY-999999' }, buildContext())) as {
      found: boolean
      claimId: string
    }

    expect(result.found).toBe(false)
    expect(result.claimId).toBe('WTY-999999')
  })
})
