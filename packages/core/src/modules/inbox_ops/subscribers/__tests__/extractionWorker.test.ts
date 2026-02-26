/** @jest-environment node */

import handle from '../extractionWorker'
import { InboxEmail, InboxProposal, InboxProposalAction, InboxDiscrepancy, InboxSettings } from '../../data/entities'

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

jest.mock('@open-mercato/core/modules/inbox_ops/lib/extractionPrompt', () => ({
  buildExtractionSystemPrompt: jest.fn(() => Promise.resolve('mock system prompt')),
  buildExtractionUserPrompt: jest.fn(() => 'mock user prompt'),
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

const mockNativeUpdate = jest.fn()
const mockFindOne = jest.fn()
const mockFlush = jest.fn()
const mockCreate = jest.fn()
const mockPersist = jest.fn()

const mockEm = {
  fork: jest.fn(),
  nativeUpdate: mockNativeUpdate,
  findOne: mockFindOne,
  find: jest.fn(),
  create: mockCreate,
  persist: mockPersist,
  flush: mockFlush,
}

const MockSalesOrder = class {} as any
const MockSalesChannel = class {} as any
const MockCatalogProduct = class {} as any
const MockCatalogProductPrice = class {} as any
const MockCustomerEntity = class {} as any

const mockCtx = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'SalesOrder') return MockSalesOrder
    if (token === 'SalesChannel') return MockSalesChannel
    if (token === 'CatalogProduct') return MockCatalogProduct
    if (token === 'CatalogProductPrice') return MockCatalogProductPrice
    if (token === 'CustomerEntity') return MockCustomerEntity
    throw new Error(`Unknown DI token: ${token}`)
  }),
}

const VALID_ORDER_PAYLOAD = JSON.stringify({
  customerName: 'John Doe',
  channelId: '123e4567-e89b-4d56-a456-426614174000',
  currencyCode: 'EUR',
  lineItems: [{ productName: 'Widget', quantity: '10' }],
})

function makeExtractionResult(overrides?: Record<string, unknown>) {
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
        payloadJson: VALID_ORDER_PAYLOAD,
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

function makeEmail(overrides?: Record<string, unknown>) {
  return {
    id: 'email-1',
    status: 'processing',
    rawText: 'Hello, I would like to order 10 widgets. Best regards, John',
    rawHtml: null,
    cleanedText: 'Hello, I would like to order 10 widgets.',
    subject: 'Order request',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    detectedLanguage: null,
    forwardedByAddress: 'john@example.com',
    forwardedByName: 'John Doe',
    replyTo: null,
    messageId: '<msg-001@example.com>',
    emailReferences: null,
    threadMessages: [
      {
        from: { name: 'John Doe', email: 'john@example.com' },
        to: [{ name: 'Ops', email: 'ops@example.com' }],
        date: new Date().toISOString(),
        body: 'Hello, I would like to order 10 widgets.',
        contentType: 'text',
        isForwarded: false,
      },
    ],
    ...overrides,
  }
}

const basePayload = {
  emailId: 'email-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  forwardedByAddress: 'john@example.com',
  subject: 'Order request',
}

describe('extractionWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.fork.mockReturnValue(mockEm)
    mockFlush.mockResolvedValue(undefined)
    mockEmitInboxOpsEvent.mockResolvedValue(undefined)
    mockCreate.mockImplementation((_entity: unknown, data: Record<string, unknown>) => ({ ...data }))
    mockMatchContacts.mockResolvedValue([])
    mockFetchCatalog.mockResolvedValue([])
    mockValidatePrices.mockResolvedValue([])
    mockFindOneWithDecryption.mockResolvedValue(null)
  })

  describe('race condition handling', () => {
    it('exits silently when another worker already claimed the email (nativeUpdate returns 0)', async () => {
      mockNativeUpdate.mockResolvedValue(0)

      await handle(basePayload, mockCtx as any)

      expect(mockNativeUpdate).toHaveBeenCalledWith(
        InboxEmail,
        { id: 'email-1', status: 'received' },
        { status: 'processing' },
      )
      expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
      expect(mockFlush).not.toHaveBeenCalled()
    })

    it('proceeds when nativeUpdate claims the email (returns 1)', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      mockFindOneWithDecryption.mockResolvedValueOnce({
        id: 'email-1',
        status: 'processing',
        rawText: '',
        rawHtml: null,
        cleanedText: '',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockNativeUpdate).toHaveBeenCalledWith(
        InboxEmail,
        { id: 'email-1', status: 'received' },
        { status: 'processing' },
      )
      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        mockEm,
        InboxEmail,
        { id: 'email-1' },
        undefined,
        expect.objectContaining({ tenantId: 'tenant-1' }),
      )
    })

    it('exits when email not found after claiming', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()

      await handle(
        { ...basePayload, emailId: 'email-missing' },
        mockCtx as any,
      )

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Email not found: email-missing'),
      )
      consoleSpy.mockRestore()
    })
  })

  describe('full pipeline — happy path', () => {
    it('creates proposal with actions and updates email status to processed', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockMatchContacts.mockResolvedValueOnce([
        {
          participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
          match: { contactId: 'contact-1', contactType: 'person', confidence: 0.95 },
        },
      ])

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult(),
        totalTokens: 150,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposal,
        expect.objectContaining({
          summary: 'Customer wants to order 10 widgets',
          confidence: '0.90',
          status: 'pending',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        }),
      )

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposalAction,
        expect.objectContaining({
          actionType: 'create_order',
          description: 'Create order for 10 widgets',
          status: 'pending',
        }),
      )

      expect(email.status).toBe('processed')

      expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
        'inbox_ops.email.processed',
        expect.objectContaining({ emailId: 'email-1' }),
      )
      expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
        'inbox_ops.proposal.created',
        expect.objectContaining({
          emailId: 'email-1',
          actionCount: 3,
        }),
      )
    })
  })

  describe('LLM failure', () => {
    it('sets email status to failed and emits email.failed event', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockRunExtraction.mockRejectedValueOnce(new Error('API rate limit exceeded'))

      await handle(basePayload, mockCtx as any)

      expect(email.status).toBe('failed')
      expect(email.processingError).toContain('API rate limit exceeded')
      expect(mockFlush).toHaveBeenCalled()
      expect(mockEmitInboxOpsEvent).toHaveBeenCalledWith(
        'inbox_ops.email.failed',
        expect.objectContaining({
          emailId: 'email-1',
          error: expect.stringContaining('API rate limit exceeded'),
        }),
      )
    })
  })

  describe('low confidence', () => {
    it('sets email status to needs_review when confidence is below threshold', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({ confidence: 0.3 }),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(email.status).toBe('needs_review')
    })
  })

  describe('empty text', () => {
    it('sets email status to failed when email has no text content', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail({ rawText: '', rawHtml: null, cleanedText: '' })
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      await handle(basePayload, mockCtx as any)

      expect(email.status).toBe('failed')
      expect(email.processingError).toContain('No text content')
      expect(mockRunExtraction).not.toHaveBeenCalled()
    })
  })

  describe('duplicate order detection', () => {
    it('creates duplicate_order discrepancy when customerReference matches existing order', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)
      mockFindOneWithDecryption.mockResolvedValueOnce(null) // InboxSettings

      const payloadWithRef = JSON.stringify({
        customerName: 'John Doe',
        channelId: '123e4567-e89b-4d56-a456-426614174000',
        currencyCode: 'EUR',
        customerReference: 'PO-2026-001',
        lineItems: [{ productName: 'Widget', quantity: '10' }],
      })

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          proposedActions: [
            {
              actionType: 'create_order',
              description: 'Create order for 10 widgets',
              confidence: 0.9,
              payloadJson: payloadWithRef,
            },
          ],
        }),
        totalTokens: 150,
        modelWithProvider: 'anthropic:test-model',
      })

      mockFindOneWithDecryption.mockResolvedValueOnce({
        id: 'existing-order-1',
        orderNumber: 'ORD-500',
        customerReference: 'PO-2026-001',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockCreate).toHaveBeenCalledWith(
        InboxDiscrepancy,
        expect.objectContaining({
          type: 'duplicate_order',
          severity: 'error',
          description: expect.stringContaining('PO-2026-001'),
        }),
      )
    })
  })

  describe('unknown contact discrepancy', () => {
    it('creates unknown_contact discrepancy when no contact match found', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockMatchContacts.mockResolvedValueOnce([
        {
          participant: { name: 'Unknown Person', email: 'unknown@example.com', role: 'buyer' },
          match: null,
        },
      ])

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          participants: [
            { name: 'Unknown Person', email: 'unknown@example.com', role: 'buyer' },
          ],
        }),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockCreate).toHaveBeenCalledWith(
        InboxDiscrepancy,
        expect.objectContaining({
          type: 'unknown_contact',
          severity: 'warning',
          description: expect.stringContaining('unknown@example.com'),
          foundValue: 'unknown@example.com',
        }),
      )
    })
  })

  describe('discrepancy action association', () => {
    it('associates product_not_found discrepancy with the order action, not auto-generated contact actions', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      // Unmatched contact → triggers auto create_contact action (prepended before order)
      mockMatchContacts.mockResolvedValueOnce([
        {
          participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
          match: null,
        },
      ])

      // Catalog has no products → line item won't match → product_not_found discrepancy
      mockFetchCatalog.mockResolvedValueOnce([])

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          participants: [
            { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
          ],
          discrepancies: [
            {
              actionIndex: 0,
              type: 'currency_mismatch',
              severity: 'warning',
              description: 'EUR vs USD',
            },
          ],
        }),
        totalTokens: 150,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      // Collect all InboxDiscrepancy create calls
      const discrepancyCalls = mockCreate.mock.calls
        .filter(([entity]: [unknown]) => entity === InboxDiscrepancy)
        .map(([, data]: [unknown, Record<string, unknown>]) => data)

      // product_not_found should point to the order action, not the create_contact
      const productDiscrepancy = discrepancyCalls.find(
        (d: Record<string, unknown>) => d.type === 'product_not_found',
      )
      expect(productDiscrepancy).toBeDefined()

      // currency_mismatch from LLM (actionIndex: 0) should also point to the order, not contact
      const currencyDiscrepancy = discrepancyCalls.find(
        (d: Record<string, unknown>) => d.type === 'currency_mismatch',
      )
      expect(currencyDiscrepancy).toBeDefined()

      // The order action creates with actionType 'create_order'
      const orderActionCall = mockCreate.mock.calls.find(
        ([entity, data]: [unknown, Record<string, unknown>]) =>
          entity === InboxProposalAction && data.actionType === 'create_order',
      )
      expect(orderActionCall).toBeDefined()
      const orderActionId = orderActionCall[1].id

      // Both discrepancies should reference the order action's ID
      if (productDiscrepancy) {
        expect(productDiscrepancy.actionId).toBe(orderActionId)
      }
      if (currencyDiscrepancy) {
        expect(currencyDiscrepancy.actionId).toBe(orderActionId)
      }
    })
  })

  describe('LLM-discovered participant create_contact', () => {
    it('generates create_contact action for unmatched participant discovered by LLM but not in email headers', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      // Header-based contact matching only finds John (the sender)
      mockMatchContacts.mockResolvedValueOnce([
        {
          participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
          match: { contactId: 'contact-1', contactType: 'person', confidence: 1.0 },
        },
      ])

      // LLM discovers an additional participant (Arjun) from the email body
      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          participants: [
            { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
            { name: 'Arjun Patel', email: 'arjun@example.com', role: 'buyer' },
          ],
          proposedActions: [
            {
              actionType: 'create_order',
              description: 'Create order',
              confidence: 0.9,
              payloadJson: VALID_ORDER_PAYLOAD,
            },
          ],
        }),
        totalTokens: 150,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      // Should create a create_contact action for Arjun (LLM-discovered, not in headers)
      const createContactCalls = mockCreate.mock.calls
        .filter(([entity, data]: [unknown, Record<string, unknown>]) =>
          entity === InboxProposalAction && data.actionType === 'create_contact',
        )
        .map(([, data]: [unknown, Record<string, unknown>]) => data)

      const arjunAction = createContactCalls.find((d: Record<string, unknown>) => {
        const payload = d.payload as Record<string, unknown>
        return payload?.email === 'arjun@example.com'
      })

      expect(arjunAction).toBeDefined()
      expect((arjunAction!.payload as Record<string, unknown>).name).toBe('Arjun Patel')

      // Should also create an unknown_contact discrepancy for Arjun
      const discrepancyCalls = mockCreate.mock.calls
        .filter(([entity]: [unknown]) => entity === InboxDiscrepancy)
        .map(([, data]: [unknown, Record<string, unknown>]) => data)

      const arjunDiscrepancy = discrepancyCalls.find(
        (d: Record<string, unknown>) =>
          d.type === 'unknown_contact' && d.foundValue === 'arjun@example.com',
      )
      expect(arjunDiscrepancy).toBeDefined()
    })
  })

  describe('partial forward detection', () => {
    it('marks proposal as possiblyIncomplete for RE: subject with single thread message', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail({
        subject: 'RE: Order confirmation',
        threadMessages: [
          {
            from: { name: 'John', email: 'john@example.com' },
            to: [{ name: 'Ops', email: 'ops@example.com' }],
            date: new Date().toISOString(),
            body: 'Partial content',
            contentType: 'text',
            isForwarded: false,
          },
        ],
      })
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({ possiblyIncomplete: false }),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposal,
        expect.objectContaining({
          possiblyIncomplete: true,
        }),
      )
    })
  })

  describe('hallucinated productId clearing', () => {
    it('generates create_product action when LLM hallucinates a productId not in catalog', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      // Contact matches: John is known
      mockMatchContacts.mockResolvedValueOnce([
        {
          participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
          match: { contactId: 'contact-1', contactType: 'person', confidence: 1.0 },
        },
      ])

      // Catalog has one product
      const realProductId = '11111111-1111-1111-1111-111111111111'
      mockFetchCatalog.mockResolvedValueOnce([
        { id: realProductId, name: 'Widget', sku: 'WDG-001' },
      ])

      // LLM returns an order with a hallucinated productId for "Silk Scarf"
      const hallucinatedProductId = '99999999-9999-9999-9999-999999999999'
      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          proposedActions: [
            {
              actionType: 'create_order',
              description: 'Create order',
              confidence: 0.9,
              payloadJson: JSON.stringify({
                customerName: 'John Doe',
                channelId: '123e4567-e89b-4d56-a456-426614174000',
                currencyCode: 'EUR',
                lineItems: [
                  { productName: 'Widget', quantity: '5', productId: realProductId },
                  { productName: 'Silk Scarf', quantity: '2', productId: hallucinatedProductId },
                ],
              }),
            },
          ],
          discrepancies: [
            {
              actionIndex: 0,
              type: 'product_not_found',
              severity: 'error',
              description: 'Product "Silk Scarf" not found',
              foundValue: 'Silk Scarf',
            },
          ],
        }),
        totalTokens: 200,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      // Should generate a create_product action for Silk Scarf
      const createProductCalls = mockCreate.mock.calls
        .filter(([entity, data]: [unknown, Record<string, unknown>]) =>
          entity === InboxProposalAction && data.actionType === 'create_product',
        )
        .map(([, data]: [unknown, Record<string, unknown>]) => data)

      expect(createProductCalls.length).toBe(1)
      const productPayload = createProductCalls[0].payload as Record<string, unknown>
      expect(productPayload.title).toBe('Silk Scarf')

      // Should have a product_not_found discrepancy from step 6c (auto-generated)
      const discrepancyCalls = mockCreate.mock.calls
        .filter(([entity]: [unknown]) => entity === InboxDiscrepancy)
        .map(([, data]: [unknown, Record<string, unknown>]) => data)

      const productNotFound = discrepancyCalls.filter(
        (d: Record<string, unknown>) => d.type === 'product_not_found',
      )
      expect(productNotFound.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('draft replies', () => {
    it('creates draft_reply actions from extraction output', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)

      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult({
          proposedActions: [],
          draftReplies: [
            {
              to: 'john@example.com',
              toName: 'John Doe',
              subject: 'Re: Order request',
              body: 'Thank you for your inquiry. We can fulfill your order.',
            },
          ],
        }),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposalAction,
        expect.objectContaining({
          actionType: 'draft_reply',
          payload: expect.objectContaining({
            to: 'john@example.com',
            subject: 'Re: Order request',
          }),
          requiredFeature: 'inbox_ops.replies.send',
        }),
      )
    })
  })

  describe('working language', () => {
    it('defaults workingLanguage to "en" when no InboxSettings found', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      // First call returns email, second (InboxSettings) returns null
      mockFindOneWithDecryption.mockResolvedValueOnce(email)
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      mockMatchContacts.mockResolvedValueOnce([])
      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult(),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      const { buildExtractionSystemPrompt } = require('@open-mercato/core/modules/inbox_ops/lib/extractionPrompt')

      await handle(basePayload, mockCtx as any)

      expect(buildExtractionSystemPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
        'en',
      )

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposal,
        expect.objectContaining({ workingLanguage: 'en' }),
      )
    })

    it('passes workingLanguage from InboxSettings to prompt and proposal', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      // First call returns email, second returns settings with German
      mockFindOneWithDecryption.mockResolvedValueOnce(email)
      mockFindOneWithDecryption.mockResolvedValueOnce({ workingLanguage: 'de' })

      mockMatchContacts.mockResolvedValueOnce([])
      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult(),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      const { buildExtractionSystemPrompt } = require('@open-mercato/core/modules/inbox_ops/lib/extractionPrompt')

      await handle(basePayload, mockCtx as any)

      expect(buildExtractionSystemPrompt).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        undefined,
        'de',
      )

      expect(mockCreate).toHaveBeenCalledWith(
        InboxProposal,
        expect.objectContaining({ workingLanguage: 'de' }),
      )
    })

    it('queries InboxSettings with correct scope filters', async () => {
      mockNativeUpdate.mockResolvedValue(1)
      const email = makeEmail()
      mockFindOneWithDecryption.mockResolvedValueOnce(email)
      mockFindOneWithDecryption.mockResolvedValueOnce(null)

      mockMatchContacts.mockResolvedValueOnce([])
      mockRunExtraction.mockResolvedValueOnce({
        object: makeExtractionResult(),
        totalTokens: 100,
        modelWithProvider: 'anthropic:test-model',
      })

      await handle(basePayload, mockCtx as any)

      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        mockEm,
        InboxSettings,
        { organizationId: 'org-1', tenantId: 'tenant-1', deletedAt: null },
        undefined,
        { organizationId: 'org-1', tenantId: 'tenant-1' },
      )
    })
  })
})
