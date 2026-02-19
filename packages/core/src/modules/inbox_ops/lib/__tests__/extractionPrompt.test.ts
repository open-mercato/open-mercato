/** @jest-environment node */

import {
  buildExtractionSystemPrompt,
  buildExtractionUserPrompt,
  REQUIRED_FEATURES_MAP,
} from '../extractionPrompt'
import type { ContactMatchResult } from '../contactMatcher'

describe('buildExtractionSystemPrompt', () => {
  it('returns a string containing the role instruction', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('email-to-ERP extraction agent')
    expect(result).toContain('<role>')
  })

  it('includes contact matches when provided', () => {
    const contacts: ContactMatchResult[] = [
      {
        participant: { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
        match: { contactId: 'c-001', contactType: 'person', contactName: 'John Doe', confidence: 0.95 },
      },
    ]
    const result = buildExtractionSystemPrompt(contacts, [])
    expect(result).toContain('Pre-matched contacts from CRM')
    expect(result).toContain('John Doe')
    expect(result).toContain('john@example.com')
    expect(result).toContain('c-001')
  })

  it('shows "No pre-matched contacts" when contacts list is empty', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('No pre-matched contacts found in CRM')
  })

  it('includes catalog products when provided', () => {
    const products = [
      { id: 'p-001', name: 'Widget A', sku: 'WA-100', price: '29.99' },
    ]
    const result = buildExtractionSystemPrompt([], products)
    expect(result).toContain('Catalog products')
    expect(result).toContain('Widget A')
    expect(result).toContain('WA-100')
  })

  it('shows "No catalog products" when products list is empty', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('No catalog products available for matching')
  })

  it('includes channel ID when provided', () => {
    const result = buildExtractionSystemPrompt([], [], 'ch-001')
    expect(result).toContain('Default sales channel ID: ch-001')
  })

  it('shows "No default sales channel" when channelId is not provided', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('No default sales channel configured')
  })

  it('includes safety instructions', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('<safety>')
    expect(result).toContain('untrusted data')
  })

  it('includes rules section', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('<rules>')
    expect(result).toContain('confidence')
  })

  it('includes required features mapping for all action types', () => {
    const result = buildExtractionSystemPrompt([], [])
    expect(result).toContain('<required_features>')
    expect(result).toContain('create_order')
    expect(result).toContain('draft_reply')
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
  it('maps all 8 action types to required features', () => {
    const expectedMappings: Record<string, string> = {
      create_order: 'sales.orders.manage',
      create_quote: 'sales.quotes.manage',
      update_order: 'sales.orders.manage',
      update_shipment: 'sales.shipments.manage',
      create_contact: 'customers.people.manage',
      link_contact: 'customers.people.manage',
      log_activity: 'customers.activities.manage',
      draft_reply: 'inbox_ops.replies.send',
    }

    expect(Object.keys(REQUIRED_FEATURES_MAP)).toHaveLength(8)

    for (const [actionType, feature] of Object.entries(expectedMappings)) {
      expect(REQUIRED_FEATURES_MAP[actionType as keyof typeof REQUIRED_FEATURES_MAP]).toBe(feature)
    }
  })
})
