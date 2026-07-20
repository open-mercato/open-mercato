import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import {
  assessDamagePhoto,
  extractProofOfPurchase,
  WarrantyAiNotConfiguredError,
} from '../lib/aiAssist'
import { aiTools } from '../ai-tools'
import { setClaimLineAssessmentCommand } from '../commands/claim-lines'
import { POST } from '../api/ai/assess/route'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '33333333-3333-4333-8333-333333333333'
const CLAIM_ID = '44444444-4444-4444-8444-444444444444'
const LINE_ID = '55555555-5555-4555-8555-555555555555'
const ATTACHMENT_ID = '66666666-6666-4666-8666-666666666666'
const CLAIM_UPDATED_AT = '2026-07-01T00:00:00.000Z'
const LINE_UPDATED_AT = '2026-07-02T09:30:00.000Z'

let mockClaim: WarrantyClaim | null = null
let mockLine: WarrantyClaimLine | null = null
let mockAttachment: Attachment | null = null
let mockAttachmentPartition: AttachmentPartition | null = null
let mockPersistedEvents: WarrantyClaimEvent[] = []

const createModelFactoryMock = jest.fn()
const generateObjectMock = jest.fn()
const findOneWithDecryptionMock = jest.fn()
const findWithDecryptionMock = jest.fn()
const emitCrudSideEffectsMock = jest.fn<Promise<void>, [Record<string, unknown>]>()
const emitCrudUndoSideEffectsMock = jest.fn<Promise<void>, [Record<string, unknown>]>()
const invalidateCrudCacheMock = jest.fn<Promise<void>, unknown[]>()
const createRequestContainerMock = jest.fn<Promise<AwilixContainer>, []>()
const getAuthFromRequestMock = jest.fn()
const resolveOrganizationScopeForRequestMock = jest.fn()
const runRouteMutationGuardsMock = jest.fn()
const commandExecuteMock = jest.fn()

jest.mock('ai', () => ({
  generateText: jest.fn(async () => ({ text: 'Draft text' })),
  generateObject: (...args: unknown[]) => generateObjectMock(...args),
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (_em: unknown, phases: Array<() => unknown | Promise<unknown>>) => {
    for (const phase of phases) {
      await phase()
    }
  },
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  emitCrudSideEffects: (input: Record<string, unknown>) => emitCrudSideEffectsMock(input),
  emitCrudUndoSideEffects: (input: Record<string, unknown>) => emitCrudUndoSideEffectsMock(input),
}))

jest.mock('@open-mercato/shared/lib/crud/cache', () => ({
  invalidateCrudCache: (...args: unknown[]) => invalidateCrudCacheMock(...args),
}))

jest.mock('../events', () => ({
  emitWarrantyClaimsEvent: jest.fn(),
}))

jest.mock('../lib/settings', () => ({
  resolveEffectiveWarrantyClaimSettings: jest.fn(async () => ({
    slaHours: 48,
    slaPauseOnInfoRequested: true,
    slaAtRiskThresholdPct: 75,
    autoApproveEnabled: false,
    autoApproveMaxAmount: null,
    autoApproveCurrencyCode: null,
    autoApproveRequireInWarranty: true,
    defaultWarrantyMonths: null,
    businessHours: null,
    escalationTiers: null,
    adjudicationUseRules: false,
    quarantineGrades: null,
    returnLabelProvider: null,
  })),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: () => createRequestContainerMock(),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => getAuthFromRequestMock(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => resolveOrganizationScopeForRequestMock(...args),
}))

jest.mock('@open-mercato/shared/lib/crud/route-mutation-guard', () => ({
  runRouteMutationGuards: (...args: unknown[]) => runRouteMutationGuardsMock(...args),
}))

function entityName(entity: unknown): string {
  return typeof entity === 'function' && 'name' in entity ? String(entity.name) : ''
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
    totalClaimedAmount: '90.00',
    totalApprovedAmount: '15.00',
    totalRecoveredAmount: '3.00',
    slaDueAt: null,
    slaPausedAt: null,
    submittedAt: null,
    resolvedAt: null,
    closedAt: null,
    assigneeUserId: null,
    createdAt: new Date(CLAIM_UPDATED_AT),
    updatedAt: new Date(CLAIM_UPDATED_AT),
    deletedAt: null,
  } as WarrantyClaim
}

function makeLine(claim: WarrantyClaim): WarrantyClaimLine {
  return {
    id: LINE_ID,
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
    qtyApproved: '1',
    qtyReceived: null,
    conditionOnReceipt: null,
    conditionGrade: null,
    quarantineStatus: 'none',
    inspectionNotes: null,
    assessmentPayload: { existing: true },
    disposition: 'credit',
    lineStatus: 'approved',
    creditAmount: '25.00',
    restockingFee: '5.00',
    coreChargeAmount: '10.00',
    coreCreditAmount: '4.00',
    vendorClaimLineId: null,
    vendorName: null,
    createdAt: new Date(CLAIM_UPDATED_AT),
    updatedAt: new Date(LINE_UPDATED_AT),
    deletedAt: null,
  } as WarrantyClaimLine
}

function makeAttachment(overrides: Partial<Attachment> = {}): Attachment {
  return {
    id: ATTACHMENT_ID,
    entityId: 'warranty_claims:warranty_claim_line',
    recordId: LINE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    partitionCode: 'private',
    fileName: 'damage.jpg',
    mimeType: 'image/jpeg',
    fileSize: 123,
    storageDriver: 'local',
    storagePath: 'damage.jpg',
    storageMetadata: {
      assignments: [
        { type: 'warranty_claims:warranty_claim_line', id: LINE_ID },
      ],
      tags: [],
    },
    url: `/api/attachments/file/${ATTACHMENT_ID}`,
    content: null,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    ...overrides,
  } as Attachment
}

function makeAttachmentPartition(): AttachmentPartition {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    code: 'private',
    title: 'Private',
    description: null,
    storageDriver: 'local',
    configJson: null,
    isPublic: false,
    requiresOcr: false,
    ocrModel: null,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    createdAt: new Date('2026-07-01T00:00:00.000Z'),
    updatedAt: new Date('2026-07-01T00:00:00.000Z'),
  } as AttachmentPartition
}

function makeEm(): EntityManager {
  const carrier: Record<string, unknown> = {}
  carrier.fork = jest.fn(() => carrier)
  carrier.findOne = jest.fn((entity: unknown) => {
    const name = entityName(entity)
    if (name === 'AttachmentPartition') return Promise.resolve(mockAttachmentPartition)
    return Promise.resolve(null)
  })
  carrier.create = jest.fn((_entity: unknown, data: unknown) => data)
  carrier.persist = jest.fn((entity: unknown) => {
    mockPersistedEvents.push(entity as WarrantyClaimEvent)
  })
  return carrier as unknown as EntityManager
}

function makeContainer(em: EntityManager): AwilixContainer {
  const commandBus = { execute: commandExecuteMock }
  const container = {
    resolve: <T = unknown>(name: string): T => {
      if (name === 'em') return em as T
      if (name === 'commandBus') return commandBus as T
      if (name === 'dataEngine') return {} as T
      throw new Error(`Unexpected container service: ${name}`)
    },
  }
  return container as unknown as AwilixContainer
}

function makeCommandContext(container: AwilixContainer): CommandRuntimeContext {
  return {
    container,
    auth: {
      sub: USER_ID,
      userId: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
    },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/warranty_claims/ai/assess'),
  }
}

function makeToolContext(container: AwilixContainer) {
  return {
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    userId: USER_ID,
    container,
    userFeatures: ['warranty_claims.claim.manage'],
    isSuperAdmin: false,
  }
}

function mockFindOne(entity: unknown): unknown {
  const name = entityName(entity)
  if (name === 'WarrantyClaim') return mockClaim
  if (name === 'WarrantyClaimLine') return mockLine
  if (name === 'Attachment') return mockAttachment
  return null
}

describe('warranty claim AI assessment packet', () => {
  const previousOptimisticLockEnv = process.env.OM_OPTIMISTIC_LOCK

  beforeAll(() => {
    process.env.OM_OPTIMISTIC_LOCK = 'all'
  })

  afterAll(() => {
    if (previousOptimisticLockEnv === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = previousOptimisticLockEnv
  })

  beforeEach(() => {
    mockClaim = makeClaim()
    mockLine = makeLine(mockClaim)
    mockAttachment = makeAttachment()
    mockAttachmentPartition = makeAttachmentPartition()
    mockPersistedEvents = []
    createModelFactoryMock.mockReset()
    generateObjectMock.mockReset()
    findOneWithDecryptionMock.mockReset()
    findWithDecryptionMock.mockReset()
    emitCrudSideEffectsMock.mockReset()
    emitCrudUndoSideEffectsMock.mockReset()
    invalidateCrudCacheMock.mockReset()
    createRequestContainerMock.mockReset()
    getAuthFromRequestMock.mockReset()
    resolveOrganizationScopeForRequestMock.mockReset()
    runRouteMutationGuardsMock.mockReset()
    commandExecuteMock.mockReset()
    findOneWithDecryptionMock.mockImplementation((_em: unknown, entity: unknown) => mockFindOne(entity))
    findWithDecryptionMock.mockResolvedValue([])
    createModelFactoryMock.mockImplementation(() => {
      throw new Error('No AI provider configured')
    })
  })

  test('vision helpers map missing model configuration to WarrantyAiNotConfiguredError', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    const authContext = {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      userId: USER_ID,
      features: ['warranty_claims.claim.manage'],
      isSuperAdmin: false,
    }

    await expect(assessDamagePhoto({
      em,
      container,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      claimId: CLAIM_ID,
      lineId: LINE_ID,
      attachmentId: ATTACHMENT_ID,
      authContext,
    })).rejects.toBeInstanceOf(WarrantyAiNotConfiguredError)

    await expect(extractProofOfPurchase({
      em,
      container,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
      attachmentId: ATTACHMENT_ID,
      authContext,
    })).rejects.toBeInstanceOf(WarrantyAiNotConfiguredError)

    expect(generateObjectMock).not.toHaveBeenCalled()
  })

  test('assess_damage_photo tool degrades to notConfigured without throwing', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    const tool = aiTools.find((candidate) => candidate.name === 'warranty_claims.assess_damage_photo')
    if (!tool) throw new Error('assess_damage_photo tool was not registered')

    await expect(tool.handler({
      claimId: CLAIM_ID,
      lineId: LINE_ID,
      attachmentId: ATTACHMENT_ID,
    }, makeToolContext(container))).resolves.toEqual({ notConfigured: true })
  })

  test('assess route maps helper notConfigured to a graceful 200 status', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    createRequestContainerMock.mockResolvedValue(container)
    getAuthFromRequestMock.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID] })
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: null,
      runAfterSuccess: jest.fn(),
    })

    const response = await POST(new Request('http://localhost/api/warranty_claims/ai/assess', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        claimId: CLAIM_ID,
        lineId: LINE_ID,
        attachmentId: ATTACHMENT_ID,
        kind: 'damage',
      }),
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'notConfigured' })
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  test('assess route rejects same-scope attachments not assigned to the claim or line', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    mockAttachment = makeAttachment({
      entityId: 'attachments:library',
      recordId: 'library-record',
      storageMetadata: {
        assignments: [
          { type: 'warranty_claims:warranty_claim', id: '88888888-8888-4888-8888-888888888888' },
        ],
        tags: [],
      },
    })
    createRequestContainerMock.mockResolvedValue(container)
    getAuthFromRequestMock.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
    })
    resolveOrganizationScopeForRequestMock.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID] })
    runRouteMutationGuardsMock.mockResolvedValue({
      ok: true,
      modifiedPayload: null,
      runAfterSuccess: jest.fn(),
    })

    const response = await POST(new Request('http://localhost/api/warranty_claims/ai/assess', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        claimId: CLAIM_ID,
        lineId: LINE_ID,
        attachmentId: ATTACHMENT_ID,
        kind: 'damage',
      }),
    }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'warranty_claims.errors.attachmentNotLinked' })
    expect(createModelFactoryMock).not.toHaveBeenCalled()
    expect(generateObjectMock).not.toHaveBeenCalled()
    expect(commandExecuteMock).not.toHaveBeenCalled()
  })

  test('set_assessment persists assessment payload without mutating money fields', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    const ctx = makeCommandContext(container)
    const claim = mockClaim
    const line = mockLine
    if (!claim || !line) throw new Error('test fixtures were not initialized')
    const beforeMoney = {
      claimTotalClaimedAmount: claim.totalClaimedAmount,
      claimTotalApprovedAmount: claim.totalApprovedAmount,
      claimTotalRecoveredAmount: claim.totalRecoveredAmount,
      creditAmount: line.creditAmount,
      restockingFee: line.restockingFee,
      coreChargeAmount: line.coreChargeAmount,
      coreCreditAmount: line.coreCreditAmount,
    }
    const assessmentPayload = {
      damage: {
        severity: 'moderate',
        misuseSuspected: false,
      },
      generatedAt: '2026-07-05T10:00:00.000Z',
    }

    await expect(setClaimLineAssessmentCommand.execute({
      id: LINE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      assessmentPayload,
      updatedAt: LINE_UPDATED_AT,
    }, ctx)).resolves.toEqual({ lineId: LINE_ID, claimId: CLAIM_ID })

    expect(line.assessmentPayload).toEqual(assessmentPayload)
    expect({
      claimTotalClaimedAmount: claim.totalClaimedAmount,
      claimTotalApprovedAmount: claim.totalApprovedAmount,
      claimTotalRecoveredAmount: claim.totalRecoveredAmount,
      creditAmount: line.creditAmount,
      restockingFee: line.restockingFee,
      coreChargeAmount: line.coreChargeAmount,
      coreCreditAmount: line.coreCreditAmount,
    }).toEqual(beforeMoney)
    expect(mockPersistedEvents).toEqual([
      expect.objectContaining({
        kind: 'system',
        visibility: 'internal',
        body: 'AI assessment recorded',
        payload: {
          action: 'ai_assessment_recorded',
          lineId: LINE_ID,
        },
      }),
    ])
  })

  test('set_assessment versions the line, not the parent claim', async () => {
    const em = makeEm()
    const container = makeContainer(em)
    const ctx = makeCommandContext(container)
    const claim = mockClaim
    const line = mockLine
    if (!claim || !line) throw new Error('test fixtures were not initialized')
    expect(claim.updatedAt?.toISOString()).not.toBe(line.updatedAt?.toISOString())

    await expect(setClaimLineAssessmentCommand.execute({
      id: LINE_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      assessmentPayload: { damage: { severity: 'minor' } },
      updatedAt: CLAIM_UPDATED_AT,
    }, ctx)).rejects.toMatchObject({
      status: 409,
      body: expect.objectContaining({
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: LINE_UPDATED_AT,
        expectedUpdatedAt: CLAIM_UPDATED_AT,
      }),
    })

    expect(line.assessmentPayload).toEqual({ existing: true })
    expect(mockPersistedEvents).toEqual([])
  })
})
