/** @jest-environment node */

import type { NormalizedInboxOpsInput } from '@open-mercato/shared/modules/inbox-ops-sources'
import handle from '../extractionWorker'
import {
  InboxDiscrepancy,
  InboxEmail,
  InboxProposal,
  InboxProposalAction,
  InboxSettings,
  InboxSourceSubmission,
} from '../../data/entities'

const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111'
const EMAIL_ID = '22222222-2222-4222-8222-222222222222'
const TENANT_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'
const CONTACT_ID = '66666666-6666-4666-8666-666666666666'
const CHANNEL_ID = '77777777-7777-4777-8777-777777777777'

const mockRunExtraction = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/llmProvider', () => ({
  runExtractionWithConfiguredProvider: (...args: unknown[]) => mockRunExtraction(...args),
}))

const mockMatchContacts = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/contactMatcher', () => ({
  matchContacts: (...args: unknown[]) => mockMatchContacts(...args),
}))

const mockFetchCatalog = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/catalogLookup', () => ({
  fetchCatalogProductsForExtraction: (...args: unknown[]) => mockFetchCatalog(...args),
}))

const mockValidatePrices = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/priceValidator', () => ({
  validatePrices: (...args: unknown[]) => mockValidatePrices(...args),
}))

const mockFindOneWithDecryption = jest.fn()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockBuildExtractionSystemPrompt = jest.fn(() => Promise.resolve('mock system prompt'))
const mockBuildExtractionUserPrompt = jest.fn(() => 'mock user prompt')
jest.mock('@open-mercato/core/modules/inbox_ops/lib/extractionPrompt', () => ({
  buildExtractionSystemPrompt: (...args: unknown[]) => mockBuildExtractionSystemPrompt(...args),
  buildExtractionUserPrompt: (...args: unknown[]) => mockBuildExtractionUserPrompt(...args),
}))

jest.mock('@open-mercato/core/modules/inbox_ops/lib/constants', () => ({
  REQUIRED_FEATURES_MAP: {
    create_order: 'sales.orders.manage',
    create_quote: 'sales.quotes.manage',
    update_order: 'sales.orders.manage',
    update_shipment: 'sales.shipments.manage',
    create_contact: 'customers.people.manage',
    create_product: 'catalog.products.manage',
    link_contact: 'customers.people.manage',
    log_activity: 'customers.activities.manage',
    draft_reply: 'inbox_ops.replies.send',
  },
}))

const mockEmitInboxOpsEvent = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/events', () => ({
  emitInboxOpsEvent: (...args: unknown[]) => mockEmitInboxOpsEvent(...args),
}))

const mockCreateMessageRecordForEmail = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/messagesIntegration', () => ({
  createMessageRecordForEmail: (...args: unknown[]) => mockCreateMessageRecordForEmail(...args),
}))

const mockGetInboxOpsSourceAdapter = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/source-registry', () => ({
  getInboxOpsSourceAdapter: (...args: unknown[]) => mockGetInboxOpsSourceAdapter(...args),
}))

const mockEnrichOrderPayload = jest.fn()
jest.mock('@open-mercato/core/modules/inbox_ops/lib/payloadEnrichment', () => ({
  enrichOrderPayload: (...args: unknown[]) => mockEnrichOrderPayload(...args),
}))

jest.mock('@open-mercato/cache', () => ({
  runWithCacheTenant: async (_tenantId: string, fn: () => Promise<unknown>) => fn(),
}))

const mockNativeUpdate = jest.fn()
const mockFlush = jest.fn()
const mockCreate = jest.fn()
const mockPersist = jest.fn()

const mockEm = {
  fork: jest.fn(),
  nativeUpdate: mockNativeUpdate,
  create: mockCreate,
  persist: mockPersist,
  flush: mockFlush,
}

const MockSalesOrder = class {}
const MockSalesChannel = class {}
const MockCatalogProduct = class {}
const MockCatalogProductPrice = class {}
const MockCustomerEntity = class {}
const MockCustomerAddress = class {}

const mockCtx = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'SalesOrder') return MockSalesOrder
    if (token === 'SalesChannel') return MockSalesChannel
    if (token === 'CatalogProduct') return MockCatalogProduct
    if (token === 'CatalogProductPrice') return MockCatalogProductPrice
    if (token === 'CustomerEntity') return MockCustomerEntity
    if (token === 'CustomerAddress') return MockCustomerAddress
    throw new Error(`Unknown DI token: ${token}`)
  }),
}

type SubmissionRecord = {
  id: string
  sourceEntityType: string
  sourceEntityId: string
  sourceArtifactId: string | null
  sourceVersion: string | null
  sourceDedupKey: string
  triggerEventId: string | null
  status: 'received' | 'processing' | 'processed' | 'failed' | 'deferred'
  legacyInboxEmailId: string | null
  normalizedTitle: string | null
  normalizedBody: string | null
  normalizedBodyFormat: string | null
  normalizedParticipants: unknown[] | null
  normalizedTimeline: unknown[] | null
  normalizedAttachments: unknown[] | null
  normalizedCapabilities: Record<string, unknown> | null
  facts: Record<string, unknown> | null
  normalizedSourceMetadata: Record<string, unknown> | null
  sourceSnapshot: Record<string, unknown> | null
  processingError: string | null
  proposalId: string | null
  requestedByUserId: string | null
  metadata: Record<string, unknown> | null
  tenantId: string
  organizationId: string
  deletedAt: null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

type LegacyEmailRecord = {
  id: string
  subject: string
  cleanedText: string
  rawText: string
  forwardedByAddress: string | null
  forwardedByName: string | null
  status: string
  tenantId: string
  organizationId: string
  detectedLanguage: string | null
  processingError: string | null
  deletedAt: null
}

let storedSubmission: SubmissionRecord | null
let storedLegacyEmail: LegacyEmailRecord | null
let storedSettings: { workingLanguage: string } | null
let storedExistingOrder: { id: string; orderNumber: string; customerReference: string } | null

const basePayload = {
  sourceSubmissionId: SUBMISSION_ID,
  tenantId: TENANT_ID,
  organizationId: ORGANIZATION_ID,
}

function makeSubmission(overrides: Partial<SubmissionRecord> = {}): SubmissionRecord {
  return {
    id: SUBMISSION_ID,
    sourceEntityType: 'inbox_ops:inbox_email',
    sourceEntityId: EMAIL_ID,
    sourceArtifactId: null,
    sourceVersion: 'email-version-1',
    sourceDedupKey: 'dedup-key-1',
    triggerEventId: null,
    status: 'processing',
    legacyInboxEmailId: EMAIL_ID,
    normalizedTitle: null,
    normalizedBody: null,
    normalizedBodyFormat: null,
    normalizedParticipants: null,
    normalizedTimeline: null,
    normalizedAttachments: null,
    normalizedCapabilities: null,
    facts: null,
    normalizedSourceMetadata: null,
    sourceSnapshot: null,
    processingError: null,
    proposalId: null,
    requestedByUserId: USER_ID,
    metadata: null,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    deletedAt: null,
    isActive: true,
    createdAt: new Date('2026-04-18T10:00:00.000Z'),
    updatedAt: new Date('2026-04-18T10:00:00.000Z'),
    ...overrides,
  }
}

function makeLegacyEmail(overrides: Partial<LegacyEmailRecord> = {}): LegacyEmailRecord {
  return {
    id: EMAIL_ID,
    subject: 'Order request',
    cleanedText: 'Hello, I would like to order 10 widgets.',
    rawText: 'Hello, I would like to order 10 widgets. Best regards, John',
    forwardedByAddress: 'john@example.com',
    forwardedByName: 'John Doe',
    status: 'processing',
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    detectedLanguage: null,
    processingError: null,
    deletedAt: null,
    ...overrides,
  }
}

function makeNormalizedInput(
  overrides: Partial<NormalizedInboxOpsInput> = {},
): NormalizedInboxOpsInput {
  return {
    sourceEntityType: 'inbox_ops:inbox_email',
    sourceEntityId: EMAIL_ID,
    sourceVersion: 'email-version-2',
    title: 'Order request',
    body: 'Hello, I would like to order 10 widgets.',
    bodyFormat: 'text',
    participants: [
      {
        identifier: 'john@example.com',
        displayName: 'John Doe',
        email: 'john@example.com',
        role: 'buyer',
      },
    ],
    timeline: [
      {
        actorIdentifier: 'john@example.com',
        actorLabel: 'John Doe',
        direction: 'email',
        text: 'Hello, I would like to order 10 widgets.',
      },
    ],
    capabilities: {
      canDraftReply: true,
      replyChannelType: 'email',
      canUseTimelineContext: true,
    },
    sourceMetadata: {
      forwardedByAddress: 'john@example.com',
      forwardedByName: 'John Doe',
      messageId: '<msg-001@example.com>',
      references: ['<ref-001@example.com>'],
      isPartialForward: false,
    },
    ...overrides,
  }
}

function makeExtractionResult(overrides: Record<string, unknown> = {}) {
  return {
    summary: 'Customer wants to order 10 widgets',
    participants: [
      { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
    ],
    proposedActions: [
      {
        actionType: 'create_order',
        description: 'Create order for 10 widgets',
        confidence: 0.9,
        payloadJson: JSON.stringify({
          customerName: 'John Doe',
          channelId: CHANNEL_ID,
          currencyCode: 'EUR',
          lineItems: [{ productName: 'Widget', quantity: '10' }],
        }),
      },
    ],
    discrepancies: [],
    draftReplies: [],
    confidence: 0.9,
    detectedLanguage: 'en',
    possiblyIncomplete: false,
    ...overrides,
  }
}

function getCreatedRecords<T>(entity: unknown): T[] {
  return mockCreate.mock.calls
    .filter(([calledEntity]: [unknown]) => calledEntity === entity)
    .map(([, data]: [unknown, T]) => data)
}

function createMockAdapter(input: NormalizedInboxOpsInput) {
  return {
    loadSource: jest.fn(async () => ({ id: input.sourceEntityId })),
    assertReady: jest.fn(async () => undefined),
    getVersion: jest.fn(async () => input.sourceVersion || null),
    buildInput: jest.fn(async () => input),
    buildPromptHints: jest.fn(async () => ({
      sourceLabel: 'email',
      sourceKind: 'email thread',
      primaryEvidence: ['timeline', 'body'],
      participantIdentityMode: 'email-first',
      replySupport: 'email',
    })),
    buildSnapshot: jest.fn(async () => ({ subject: input.title || null })),
  }
}

describe('extractionWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockNativeUpdate.mockResolvedValue(1)
    mockFlush.mockResolvedValue(undefined)
    mockCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
    mockCreateMessageRecordForEmail.mockResolvedValue(null)
    mockMatchContacts.mockResolvedValue([])
    mockFetchCatalog.mockResolvedValue([])
    mockValidatePrices.mockResolvedValue([])
    mockEnrichOrderPayload.mockImplementation(async (payload: Record<string, unknown>) => ({
      payload,
      warnings: [],
    }))
    storedSubmission = makeSubmission()
    storedLegacyEmail = makeLegacyEmail()
    storedSettings = null
    storedExistingOrder = null

    mockFindOneWithDecryption.mockImplementation(
      async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
        if (entity === InboxSourceSubmission) {
          return storedSubmission && where.id === storedSubmission.id ? storedSubmission : null
        }
        if (entity === InboxEmail) {
          return storedLegacyEmail && where.id === storedLegacyEmail.id ? storedLegacyEmail : null
        }
        if (entity === InboxSettings) {
          return storedSettings
        }
        if (entity === MockSalesOrder) {
          return storedExistingOrder
        }
        if (entity === MockSalesChannel) {
          return null
        }
        return null
      },
    )

    jest.spyOn(console, 'debug').mockImplementation(() => {})
    jest.spyOn(console, 'error').mockImplementation(() => {})
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('returns immediately when another worker already claimed the submission', async () => {
    mockNativeUpdate.mockResolvedValue(0)

    await handle(basePayload, mockCtx as never)

    expect(mockNativeUpdate).toHaveBeenCalledWith(
      InboxSourceSubmission,
      { id: SUBMISSION_ID, status: 'received' },
      { status: 'processing', processingError: null },
    )
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
  })

  it('logs and exits when the submission disappears after it was claimed', async () => {
    storedSubmission = null

    await handle(basePayload, mockCtx as never)

    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining(`Source submission not found: ${SUBMISSION_ID}`),
    )
    expect(mockRunExtraction).not.toHaveBeenCalled()
  })

  it('processes legacy email-backed submissions through the source-native flow', async () => {
    const normalizedInput = makeNormalizedInput()
    const adapter = createMockAdapter(normalizedInput)
    mockGetInboxOpsSourceAdapter.mockResolvedValue(adapter)
    mockMatchContacts.mockResolvedValueOnce([
      {
        participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
        match: { contactId: CONTACT_ID, contactType: 'person', confidence: 0.95 },
      },
    ])
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult(),
      totalTokens: 150,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(storedSubmission?.status).toBe('processed')
    expect(storedSubmission?.normalizedBody).toBe(normalizedInput.body)
    expect(storedSubmission?.normalizedTitle).toBe(normalizedInput.title)
    expect(storedSubmission?.normalizedCapabilities).toEqual(normalizedInput.capabilities)
    expect(storedSubmission?.sourceVersion).toBe('email-version-2')
    expect(storedSubmission?.proposalId).toEqual(expect.any(String))
    expect(storedLegacyEmail?.status).toBe('processed')

    expect(mockBuildExtractionSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        matchedContacts: expect.any(Array),
        catalogProducts: [],
        workingLanguage: 'en',
        sourceInput: normalizedInput,
        promptHints: expect.objectContaining({ sourceKind: 'email thread' }),
      }),
    )
    expect(mockBuildExtractionUserPrompt).toHaveBeenCalledWith(normalizedInput)

    expect(mockCreate).toHaveBeenCalledWith(
      InboxProposal,
      expect.objectContaining({
        inboxEmailId: EMAIL_ID,
        sourceSubmissionId: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: EMAIL_ID,
        summary: 'Customer wants to order 10 widgets',
        confidence: '0.90',
        status: 'pending',
        workingLanguage: 'en',
      }),
    )
    expect(mockCreate).toHaveBeenCalledWith(
      InboxProposalAction,
      expect.objectContaining({
        actionType: 'create_order',
        description: 'Create order for 10 widgets',
        requiredFeature: 'sales.orders.manage',
      }),
    )

    expect(mockCreateMessageRecordForEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        id: EMAIL_ID,
        subject: 'Order request',
        forwardedByAddress: 'john@example.com',
      }),
      expect.objectContaining({
        scope: expect.objectContaining({
          tenantId: TENANT_ID,
          organizationId: ORGANIZATION_ID,
        }),
      }),
    )

    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.source_submission.processed',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:inbox_email',
        sourceEntityId: EMAIL_ID,
      }),
    )
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.proposal.created',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        emailId: EMAIL_ID,
        actionCount: 2,
      }),
    )
  })

  it('marks the submission and legacy email as failed when extraction crashes', async () => {
    const normalizedInput = makeNormalizedInput()
    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockRejectedValueOnce(new Error('API rate limit exceeded'))

    await handle(basePayload, mockCtx as never)

    expect(storedSubmission?.status).toBe('failed')
    expect(storedSubmission?.processingError).toContain('API rate limit exceeded')
    expect(storedLegacyEmail?.status).toBe('failed')
    expect(storedLegacyEmail?.processingError).toContain('API rate limit exceeded')
    expect(mockCreateMessageRecordForEmail).not.toHaveBeenCalled()

    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.source_submission.failed',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        error: expect.stringContaining('API rate limit exceeded'),
      }),
    )
  })

  it('marks the legacy email as needs_review when extraction confidence is below threshold', async () => {
    const normalizedInput = makeNormalizedInput()
    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult({ confidence: 0.2 }),
      totalTokens: 90,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(storedSubmission?.status).toBe('processed')
    expect(storedLegacyEmail?.status).toBe('needs_review')
  })

  it('marks proposals as possibly incomplete when the source metadata says the content is partial', async () => {
    const normalizedInput = makeNormalizedInput({
      sourceMetadata: {
        forwardedByAddress: 'john@example.com',
        isPartialForward: true,
      },
    })
    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult({ possiblyIncomplete: false }),
      totalTokens: 110,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(mockCreate).toHaveBeenCalledWith(
      InboxProposal,
      expect.objectContaining({
        possiblyIncomplete: true,
      }),
    )
  })

  it('processes manual source submissions without email side effects', async () => {
    storedSubmission = makeSubmission({
      sourceEntityType: 'inbox_ops:source_submission',
      sourceEntityId: SUBMISSION_ID,
      legacyInboxEmailId: null,
    })
    storedLegacyEmail = null

    const normalizedInput = makeNormalizedInput({
      sourceEntityType: 'inbox_ops:source_submission',
      sourceEntityId: SUBMISSION_ID,
      participants: [],
      capabilities: {
        canDraftReply: false,
        canUseTimelineContext: false,
      },
      sourceMetadata: {
        source: 'manual text',
      },
    })

    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult({
        participants: [],
      }),
      totalTokens: 80,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(storedSubmission?.status).toBe('processed')
    expect(mockCreate).toHaveBeenCalledWith(
      InboxProposal,
      expect.objectContaining({
        inboxEmailId: null,
        sourceSubmissionId: SUBMISSION_ID,
        sourceEntityType: 'inbox_ops:source_submission',
        sourceEntityId: SUBMISSION_ID,
      }),
    )
    expect(mockCreateMessageRecordForEmail).not.toHaveBeenCalled()
    expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
      'inbox_ops.proposal.created',
      expect.objectContaining({
        sourceSubmissionId: SUBMISSION_ID,
        emailId: SUBMISSION_ID,
      }),
    )
  })

  it('passes the tenant working language into prompt construction and proposals', async () => {
    storedSettings = { workingLanguage: 'de' }
    const normalizedInput = makeNormalizedInput()
    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult(),
      totalTokens: 140,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(mockBuildExtractionSystemPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        workingLanguage: 'de',
      }),
    )
    expect(mockCreate).toHaveBeenCalledWith(
      InboxProposal,
      expect.objectContaining({
        workingLanguage: 'de',
      }),
    )
  })

  it('creates duplicate_order discrepancies for repeated customer references', async () => {
    const normalizedInput = makeNormalizedInput()
    storedExistingOrder = {
      id: '88888888-8888-4888-8888-888888888888',
      orderNumber: 'ORD-500',
      customerReference: 'PO-2026-001',
    }
    mockGetInboxOpsSourceAdapter.mockResolvedValue(createMockAdapter(normalizedInput))
    mockRunExtraction.mockResolvedValueOnce({
      object: makeExtractionResult({
        proposedActions: [
          {
            actionType: 'create_order',
            description: 'Create order for 10 widgets',
            confidence: 0.9,
            payloadJson: JSON.stringify({
              customerName: 'John Doe',
              channelId: CHANNEL_ID,
              currencyCode: 'EUR',
              customerReference: 'PO-2026-001',
              lineItems: [{ productName: 'Widget', quantity: '10' }],
            }),
          },
        ],
      }),
      totalTokens: 150,
      modelWithProvider: 'anthropic:test-model',
    })

    await handle(basePayload, mockCtx as never)

    expect(getCreatedRecords<Record<string, unknown>>(InboxDiscrepancy)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'duplicate_order',
          severity: 'error',
          description: 'inbox_ops.discrepancy.desc.duplicate_order_reference',
        }),
      ]),
    )
  })
})
