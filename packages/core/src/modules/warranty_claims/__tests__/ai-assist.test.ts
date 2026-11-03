import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import {
  assembleClaimReplyPrompt,
  assembleClaimSummaryPrompt,
  buildClaimReplyDraft,
  WarrantyAiNotConfiguredError,
  type ClaimPromptFacts,
} from '../lib/aiAssist'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const CLAIM_ID = '33333333-3333-4333-8333-333333333333'

const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const createModelFactoryMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory', () => {
  class AiModelFactoryError extends Error {
    readonly code: string

    constructor(code: string, message: string) {
      super(message)
      this.name = 'AiModelFactoryError'
      this.code = code
    }
  }
  return {
    AiModelFactoryError,
    createModelFactory: (...args: unknown[]) => createModelFactoryMock(...args),
  }
})

jest.mock('ai', () => ({
  generateText: jest.fn(async () => ({ text: 'Draft text' })),
}))

function baseFacts(overrides: Partial<ClaimPromptFacts> = {}): ClaimPromptFacts {
  return {
    claimNumber: 'WTY-000123',
    status: 'in_review',
    claimType: 'warranty',
    priority: 'high',
    reasonCode: 'defective',
    rejectionReasonCode: null,
    customerName: 'Acme Distribution',
    contactName: null,
    resolutionSummary: null,
    totals: {
      currencyCode: 'USD',
      claimedAmount: '120.00',
      approvedAmount: null,
      recoveredAmount: null,
    },
    lines: [
      {
        productName: 'Hydraulic Pump',
        sku: 'PUMP-100',
        serialNumber: 'SN-123',
        lineStatus: 'pending',
        disposition: 'replace',
        qtyClaimed: '1',
        qtyApproved: null,
        warrantyStatus: 'in_warranty',
      },
    ],
    timeline: [
      {
        kind: 'comment',
        visibility: 'customer',
        body: 'Bonjour, the pump failed after installation.',
        createdAt: '2026-07-01T10:00:00.000Z',
      },
      {
        kind: 'comment',
        visibility: 'internal',
        body: 'INTERNAL_MARKER_DO_NOT_LEAK',
        createdAt: '2026-07-01T11:00:00.000Z',
      },
    ],
    ...overrides,
  }
}

function makeClaim(): WarrantyClaim {
  return {
    id: CLAIM_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    claimNumber: 'WTY-000123',
    claimType: 'warranty',
    status: 'in_review',
    channel: 'staff',
    priority: 'normal',
    customerId: null,
    customerName: 'Acme Distribution',
    vendorName: null,
    vendorRef: null,
    orderId: null,
    salesReturnId: null,
    replacementOrderId: null,
    sourceClaimId: null,
    advanceReplacement: false,
    advanceShippedAt: null,
    reasonCode: null,
    rejectionReasonCode: null,
    resolutionSummary: null,
    notes: null,
    currencyCode: 'USD',
    totalClaimedAmount: '120.00',
    totalApprovedAmount: null,
    totalRecoveredAmount: null,
    slaDueAt: null,
    slaPausedAt: null,
    submittedAt: null,
    resolvedAt: null,
    closedAt: null,
    assigneeUserId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
  } as WarrantyClaim
}

function makeLine(claim: WarrantyClaim): WarrantyClaimLine {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    claim,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    lineNo: 1,
    productId: null,
    variantId: null,
    sku: 'PUMP-100',
    productName: 'Hydraulic Pump',
    orderLineId: null,
    serialNumber: 'SN-123',
    lotNumber: null,
    purchaseDate: null,
    warrantyMonths: null,
    warrantyExpiresAt: null,
    warrantyStatus: 'in_warranty',
    faultCode: null,
    faultDescription: null,
    qtyClaimed: '1',
    qtyApproved: null,
    qtyReceived: null,
    conditionOnReceipt: null,
    inspectionNotes: null,
    disposition: 'replace',
    lineStatus: 'pending',
    creditAmount: null,
    restockingFee: null,
    coreChargeAmount: null,
    coreCreditAmount: null,
    vendorClaimLineId: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    deletedAt: null,
  } as WarrantyClaimLine
}

function makeEvent(claim: WarrantyClaim): WarrantyClaimEvent {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    claim,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    kind: 'comment',
    visibility: 'customer',
    body: 'Customer-visible body',
    payload: null,
    actorUserId: null,
    actorCustomerId: null,
    createdAt: new Date('2026-07-01T10:00:00.000Z'),
  } as WarrantyClaimEvent
}

describe('warranty claim AI assist', () => {
  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
    createModelFactoryMock.mockReset()
  })

  test('assembleClaimReplyPrompt includes claim and line facts but excludes internal timeline entries', () => {
    const prompt = assembleClaimReplyPrompt(baseFacts({ tone: 'formal' }))
    const combined = `${prompt.system}\n${prompt.prompt}`

    expect(combined).toContain('WTY-000123')
    expect(combined).toContain('Hydraulic Pump')
    expect(combined).toContain('PUMP-100')
    expect(combined).not.toContain('INTERNAL_MARKER_DO_NOT_LEAK')
    expect(combined).toContain('Use a formal, professional tone.')

    const friendly = assembleClaimReplyPrompt(baseFacts({ tone: 'friendly' }))
    expect(friendly.system).toContain('Use a friendly, reassuring tone.')
  })

  test('assembleClaimSummaryPrompt includes internal and customer entries and open questions instruction', () => {
    const prompt = assembleClaimSummaryPrompt(baseFacts())
    const combined = `${prompt.system}\n${prompt.prompt}`

    expect(combined).toContain('Bonjour, the pump failed after installation.')
    expect(combined).toContain('INTERNAL_MARKER_DO_NOT_LEAK')
    expect(combined).toContain('Open questions')
  })

  test('buildClaimReplyDraft maps model factory errors to WarrantyAiNotConfiguredError', async () => {
    const { AiModelFactoryError } = jest.requireMock('@open-mercato/ai-assistant/modules/ai_assistant/lib/model-factory') as {
      AiModelFactoryError: new (code: string, message: string) => Error
    }
    const claim = makeClaim()
    findOneWithDecryptionMock.mockResolvedValue(claim)
    findWithDecryptionMock
      .mockResolvedValueOnce([makeLine(claim)])
      .mockResolvedValueOnce([makeEvent(claim)])
    createModelFactoryMock.mockImplementation(() => ({
      resolveModel: () => {
        throw new AiModelFactoryError('no_provider_configured', 'No provider configured')
      },
    }))

    await expect(buildClaimReplyDraft({
      em: {} as EntityManager,
      container: {} as AwilixContainer,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      claimId: CLAIM_ID,
    })).rejects.toBeInstanceOf(WarrantyAiNotConfiguredError)

    expect(findOneWithDecryptionMock).toHaveBeenCalledWith(
      {},
      WarrantyClaim,
      { id: CLAIM_ID, tenantId: TENANT_ID, organizationId: ORG_ID, deletedAt: null },
      {},
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
  })

  test('aiTools registers draft and summary tools with expected features', async () => {
    const { aiTools } = await import('../ai-tools')
    const draftTool = aiTools.find((tool) => tool.name === 'warranty_claims.draft_customer_reply')
    const summaryTool = aiTools.find((tool) => tool.name === 'warranty_claims.summarize_claim')

    expect(draftTool?.requiredFeatures).toEqual(['warranty_claims.claim.manage'])
    expect(summaryTool?.requiredFeatures).toEqual(['warranty_claims.claim.view'])
  })
})
