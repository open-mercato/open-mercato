/** @jest-environment node */

import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  REQUIRED_FEATURES_MAP,
} from '../extractionPrompt'
import type { ContactMatchResult } from '../contactMatcher'
import type { InboxActionDefinition } from '@open-mercato/shared/modules/inbox-actions'

const mockActions: InboxActionDefinition[] = [
  {
    type: 'create_order',
    requiredFeature: 'sales.orders.manage',
    payloadSchema: {} as InboxActionDefinition['payloadSchema'],
    promptSchema: 'create_order / create_quote payload:\n{ customerName: string, currencyCode: string }',
    promptRules: [
      'ALWAYS propose a create_order or create_quote action when the customer expresses interest in buying.',
      'For create_order / create_quote: each line item MUST have "productName".',
    ],
    execute: jest.fn(),
  },
  {
    type: 'create_quote',
    requiredFeature: 'sales.quotes.manage',
    payloadSchema: {} as InboxActionDefinition['payloadSchema'],
    promptSchema: '(shared with create_order above)',
    execute: jest.fn(),
  },
  {
    type: 'create_contact',
    requiredFeature: 'customers.people.manage',
    payloadSchema: {} as InboxActionDefinition['payloadSchema'],
    promptSchema: 'create_contact payload:\n{ type: "person"|"company", name: string, email?: string }',
    promptRules: [
      'For create_contact: always include email when available from the thread.',
    ],
    execute: jest.fn(),
  },
  {
    type: 'draft_reply',
    requiredFeature: 'inbox_ops.replies.send',
    payloadSchema: {} as InboxActionDefinition['payloadSchema'],
    promptSchema: 'draft_reply payload:\n{ to: string (email), subject: string, body: string }',
    promptRules: ['For draft_reply: include ERP context when available.'],
    execute: jest.fn(),
  },
]

describe('buildExtractionSystemPrompt', () => {
  it('returns a string containing the role instruction', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('email-to-ERP extraction agent')
    expect(result).toContain('<role>')
  })

  it('includes contact matches when provided', async () => {
    const contacts: ContactMatchResult[] = [
      {
        participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
        match: { contactId: 'c-001', contactType: 'person', contactName: 'John Doe', confidence: 0.95 },
      },
    ]
    const result = await buildExtractionSystemPrompt(contacts, [], undefined, undefined, mockActions)
    expect(result).toContain('Pre-matched contacts from CRM')
    expect(result).toContain('John Doe')
    expect(result).toContain('john@example.com')
    expect(result).toContain('c-001')
  })

  it('shows "No pre-matched contacts" when contacts list is empty', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('No pre-matched contacts found in CRM')
  })

  it('includes catalog products when provided', async () => {
    const products = [
      { id: 'p-001', name: 'Widget A', sku: 'WA-100', price: '29.99' },
    ]
    const result = await buildExtractionSystemPrompt([], products, undefined, undefined, mockActions)
    expect(result).toContain('Catalog products')
    expect(result).toContain('Widget A')
    expect(result).toContain('WA-100')
  })

  it('shows "No catalog products" when products list is empty', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('No catalog products available for matching')
  })

  it('includes channel ID when provided', async () => {
    const result = await buildExtractionSystemPrompt([], [], 'ch-001', undefined, mockActions)
    expect(result).toContain('Default sales channel ID: ch-001')
  })

  it('shows "No default sales channel" when channelId is not provided', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('No default sales channel configured')
  })

  it('includes safety instructions', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('<safety>')
    expect(result).toContain('untrusted data')
  })

  it('includes rules section', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('<rules>')
    expect(result).toContain('confidence')
  })

  it('includes required features from registered actions', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('<required_features>')
    expect(result).toContain('create_order')
    expect(result).toContain('draft_reply')
  })

  it('includes payload schemas from registered actions', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('<payload_schemas>')
    expect(result).toContain('create_order / create_quote payload:')
    expect(result).toContain('create_contact payload:')
    expect(result).toContain('draft_reply payload:')
  })

  it('excludes shared-reference schemas like "(shared with create_order above)"', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).not.toContain('(shared with create_order above)')
  })

  it('includes action-specific prompt rules', async () => {
    const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
    expect(result).toContain('ALWAYS propose a create_order')
    expect(result).toContain('For create_contact: always include email')
    expect(result).toContain('For draft_reply: include ERP context')
  })

  describe('workingLanguage parameter', () => {
    it('defaults to English when workingLanguage is not provided', async () => {
      const result = await buildExtractionSystemPrompt([], [], undefined, undefined, mockActions)
      expect(result).toContain('in English even if')
    })

    it('uses German when workingLanguage is "de"', async () => {
      const result = await buildExtractionSystemPrompt([], [], undefined, 'de', mockActions)
      expect(result).toContain('in German even if')
    })

    it('uses Spanish when workingLanguage is "es"', async () => {
      const result = await buildExtractionSystemPrompt([], [], undefined, 'es', mockActions)
      expect(result).toContain('in Spanish even if')
    })

    it('uses Polish when workingLanguage is "pl"', async () => {
      const result = await buildExtractionSystemPrompt([], [], undefined, 'pl', mockActions)
      expect(result).toContain('in Polish even if')
    })

    it('falls back to English for unknown language codes', async () => {
      const result = await buildExtractionSystemPrompt([], [], undefined, 'xx', mockActions)
      expect(result).toContain('in English even if')
    })
  })
})

describe('buildExtractionUserPrompt', () => {
  it('wraps email content in <email_content> XML delimiters', () => {
    const content = 'Dear team, please process our order for 100 units.'
    const result = buildExtractionUserPrompt(content)
    expect(result).toContain('<email_content>')
    expect(result).toContain('</email_content>')
    expect(result).toContain(content)
  })

  it('includes output requirements', () => {
    const result = buildExtractionUserPrompt('test content')
    expect(result).toContain('<output_requirements>')
    expect(result).toContain('summary')
    expect(result).toContain('proposedActions')
  })

  it('includes task instruction', () => {
    const result = buildExtractionUserPrompt('test')
    expect(result).toContain('<task>')
    expect(result).toContain('Extract actionable ERP proposals')
  })
})

describe('REQUIRED_FEATURES_MAP', () => {
  it('maps all 9 action types to required features', () => {
    const expectedMappings: Record<string, string> = {
      create_order: 'sales.orders.manage',
      create_quote: 'sales.quotes.manage',
      update_order: 'sales.orders.manage',
      update_shipment: 'sales.shipments.manage',
      create_contact: 'customers.people.manage',
      create_product: 'catalog.products.manage',
      link_contact: 'customers.people.manage',
      log_activity: 'customers.activities.manage',
      draft_reply: 'inbox_ops.replies.send',
    }

    expect(Object.keys(REQUIRED_FEATURES_MAP)).toHaveLength(9)

    for (const [actionType, feature] of Object.entries(expectedMappings)) {
      expect(REQUIRED_FEATURES_MAP[actionType as keyof typeof REQUIRED_FEATURES_MAP]).toBe(feature)
    }
  })
})
