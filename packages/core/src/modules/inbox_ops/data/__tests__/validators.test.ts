/** @jest-environment node */

import {
  orderPayloadSchema,
  updateOrderPayloadSchema,
  updateShipmentPayloadSchema,
  createContactPayloadSchema,
  linkContactPayloadSchema,
  logActivityPayloadSchema,
  draftReplyPayloadSchema,
  extractionOutputSchema,
  validateActionPayloadForType,
} from '../validators'

describe('orderPayloadSchema', () => {
  const validPayload = {
    customerName: 'John Doe',
    channelId: '550e8400-e29b-41d4-a716-446655440000',
    currencyCode: 'USD',
    lineItems: [
      { productName: 'Widget A', quantity: '10', kind: 'product' },
    ],
  }

  it('accepts valid order payload', () => {
    const result = orderPayloadSchema.safeParse(validPayload)
    expect(result.success).toBe(true)
  })

  it('rejects missing customerName', () => {
    const result = orderPayloadSchema.safeParse({ ...validPayload, customerName: '' })
    expect(result.success).toBe(false)
  })

  it('rejects empty lineItems', () => {
    const result = orderPayloadSchema.safeParse({ ...validPayload, lineItems: [] })
    expect(result.success).toBe(false)
  })

  it('rejects invalid quantity format', () => {
    const result = orderPayloadSchema.safeParse({
      ...validPayload,
      lineItems: [{ productName: 'A', quantity: 'abc' }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts decimal quantities', () => {
    const result = orderPayloadSchema.safeParse({
      ...validPayload,
      lineItems: [{ productName: 'A', quantity: '10.5', kind: 'product' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional fields', () => {
    const result = orderPayloadSchema.safeParse({
      ...validPayload,
      customerEmail: 'john@example.com',
      customerEntityId: '550e8400-e29b-41d4-a716-446655440001',
      taxRateId: '550e8400-e29b-41d4-a716-446655440002',
      requestedDeliveryDate: '2026-03-15',
      notes: 'Urgent delivery',
      customerReference: 'PO-12345',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid currencyCode length', () => {
    const result = orderPayloadSchema.safeParse({ ...validPayload, currencyCode: 'US' })
    expect(result.success).toBe(false)
  })
})

describe('updateOrderPayloadSchema', () => {
  it('accepts update with orderId', () => {
    const result = updateOrderPayloadSchema.safeParse({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      quantityChanges: [{ lineItemName: 'Widget A', newQuantity: '5' }],
    })
    expect(result.success).toBe(true)
  })

  it('accepts update with orderNumber', () => {
    const result = updateOrderPayloadSchema.safeParse({
      orderNumber: 'ORD-001',
      deliveryDateChange: { newDate: '2026-04-01' },
    })
    expect(result.success).toBe(true)
  })

  it('rejects when neither orderId nor orderNumber provided', () => {
    const result = updateOrderPayloadSchema.safeParse({
      quantityChanges: [{ lineItemName: 'Widget', newQuantity: '5' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('updateShipmentPayloadSchema', () => {
  it('accepts valid shipment update', () => {
    const result = updateShipmentPayloadSchema.safeParse({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
      statusLabel: 'Shipped',
      trackingNumbers: ['TRACK-123'],
      carrierName: 'DHL',
    })
    expect(result.success).toBe(true)
  })

  it('requires at least order reference', () => {
    const result = updateShipmentPayloadSchema.safeParse({
      statusLabel: 'Shipped',
    })
    expect(result.success).toBe(false)
  })

  it('requires statusLabel', () => {
    const result = updateShipmentPayloadSchema.safeParse({
      orderId: '550e8400-e29b-41d4-a716-446655440000',
    })
    expect(result.success).toBe(false)
  })
})

describe('createContactPayloadSchema', () => {
  it('accepts valid person contact', () => {
    const result = createContactPayloadSchema.safeParse({
      type: 'person',
      name: 'Jane Smith',
      email: 'jane@example.com',
      phone: '+1234567890',
    })
    expect(result.success).toBe(true)
  })

  it('accepts valid company contact', () => {
    const result = createContactPayloadSchema.safeParse({
      type: 'company',
      name: 'Acme Corp',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid type', () => {
    const result = createContactPayloadSchema.safeParse({
      type: 'organization',
      name: 'Acme',
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty name', () => {
    const result = createContactPayloadSchema.safeParse({
      type: 'person',
      name: '',
    })
    expect(result.success).toBe(false)
  })

  it('defaults source to inbox_ops', () => {
    const result = createContactPayloadSchema.safeParse({
      type: 'person',
      name: 'Test',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.source).toBe('inbox_ops')
    }
  })
})

describe('linkContactPayloadSchema', () => {
  it('accepts valid link payload', () => {
    const result = linkContactPayloadSchema.safeParse({
      emailAddress: 'john@example.com',
      contactId: '550e8400-e29b-41d4-a716-446655440000',
      contactType: 'person',
      contactName: 'John Doe',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const result = linkContactPayloadSchema.safeParse({
      emailAddress: 'not-an-email',
      contactId: '550e8400-e29b-41d4-a716-446655440000',
      contactType: 'person',
      contactName: 'John',
    })
    expect(result.success).toBe(false)
  })
})

describe('logActivityPayloadSchema', () => {
  it('accepts valid activity payload', () => {
    const result = logActivityPayloadSchema.safeParse({
      contactType: 'person',
      contactName: 'John Doe',
      activityType: 'email',
      subject: 'Follow-up',
      body: 'Discussed next steps',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid activity type', () => {
    const result = logActivityPayloadSchema.safeParse({
      contactType: 'person',
      contactName: 'John',
      activityType: 'sms',
      subject: 'Test',
      body: 'Test body',
    })
    expect(result.success).toBe(false)
  })
})

describe('draftReplyPayloadSchema', () => {
  it('accepts valid draft reply payload', () => {
    const result = draftReplyPayloadSchema.safeParse({
      to: 'john@example.com',
      subject: 'Re: Order request',
      body: 'Thank you for your order. We will process it shortly.',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing body', () => {
    const result = draftReplyPayloadSchema.safeParse({
      to: 'john@example.com',
      subject: 'Re: Order',
    })
    expect(result.success).toBe(false)
  })

  it('accepts optional threading fields', () => {
    const result = draftReplyPayloadSchema.safeParse({
      to: 'john@example.com',
      subject: 'Re: Order',
      body: 'Reply body',
      inReplyToMessageId: '<msg-001@example.com>',
      references: ['<msg-001@example.com>'],
      context: 'Customer requested order update',
    })
    expect(result.success).toBe(true)
  })

  it('rejects invalid email in to field', () => {
    const result = draftReplyPayloadSchema.safeParse({
      to: 'not-an-email',
      subject: 'Test',
      body: 'Test body',
    })
    expect(result.success).toBe(false)
  })
})

describe('extractionOutputSchema', () => {
  const validOutput = {
    summary: 'Customer requests 100 units of Widget A',
    participants: [
      { name: 'John Doe', email: 'john@example.com', role: 'buyer' },
    ],
    proposedActions: [
      {
        actionType: 'create_order',
        description: 'Create order for Widget A',
        confidence: 0.9,
        requiredFeature: 'sales.orders.manage',
        payloadJson: '{"customerName":"John","channelId":"abc","currencyCode":"USD","lineItems":[]}',
      },
    ],
    discrepancies: [],
    draftReplies: [],
    confidence: 0.85,
    detectedLanguage: 'en',
    possiblyIncomplete: false,
  }

  it('accepts a valid full extraction output', () => {
    const result = extractionOutputSchema.safeParse(validOutput)
    expect(result.success).toBe(true)
  })

  it('rejects missing summary', () => {
    const { summary, ...rest } = validOutput
    const result = extractionOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('rejects missing participants', () => {
    const { participants, ...rest } = validOutput
    const result = extractionOutputSchema.safeParse(rest)
    expect(result.success).toBe(false)
  })

  it('accepts confidence at boundary 0.0', () => {
    const result = extractionOutputSchema.safeParse({ ...validOutput, confidence: 0.0 })
    expect(result.success).toBe(true)
  })

  it('accepts confidence at boundary 0.5', () => {
    const result = extractionOutputSchema.safeParse({ ...validOutput, confidence: 0.5 })
    expect(result.success).toBe(true)
  })

  it('accepts confidence at boundary 1.0', () => {
    const result = extractionOutputSchema.safeParse({ ...validOutput, confidence: 1.0 })
    expect(result.success).toBe(true)
  })

  it('rejects non-numeric confidence', () => {
    const result = extractionOutputSchema.safeParse({ ...validOutput, confidence: 'high' })
    expect(result.success).toBe(false)
  })

  it('validates action types within proposedActions', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      proposedActions: [{
        actionType: 'invalid_action',
        description: 'test',
        confidence: 0.5,
        payloadJson: '{}',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts all valid action types', () => {
    const actionTypes = [
      'create_order', 'create_quote', 'update_order', 'update_shipment',
      'create_contact', 'link_contact', 'log_activity', 'draft_reply',
    ]
    for (const actionType of actionTypes) {
      const result = extractionOutputSchema.safeParse({
        ...validOutput,
        proposedActions: [{
          actionType,
          description: 'test',
          confidence: 0.5,
          payloadJson: '{}',
        }],
      })
      expect(result.success).toBe(true)
    }
  })

  it('accepts empty arrays for actions and discrepancies', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      proposedActions: [],
      discrepancies: [],
      draftReplies: [],
    })
    expect(result.success).toBe(true)
  })

  it('accepts optional detectedLanguage and possiblyIncomplete', () => {
    const { detectedLanguage, possiblyIncomplete, ...rest } = validOutput
    const result = extractionOutputSchema.safeParse(rest)
    expect(result.success).toBe(true)
  })

  it('validates discrepancy types', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      discrepancies: [{
        type: 'invalid_type',
        severity: 'warning',
        description: 'test',
      }],
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid discrepancies', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      discrepancies: [
        { type: 'price_mismatch', severity: 'warning', description: 'Price differs from catalog', expectedValue: '10.00', foundValue: '12.00' },
        { type: 'unknown_contact', severity: 'error', description: 'Contact not in CRM' },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts draftReplies with all fields', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      draftReplies: [{
        to: 'john@example.com',
        toName: 'John',
        subject: 'Re: Order',
        body: 'Thank you for your order.',
        context: 'Customer placed order',
      }],
    })
    expect(result.success).toBe(true)
  })

  it('validates participant role enum', () => {
    const result = extractionOutputSchema.safeParse({
      ...validOutput,
      participants: [{ name: 'Test', email: 'test@test.com', role: 'invalid_role' }],
    })
    expect(result.success).toBe(false)
  })
})

describe('validateActionPayloadForType', () => {
  it('validates create_order payload', () => {
    const result = validateActionPayloadForType('create_order', {
      customerName: 'John',
      channelId: '550e8400-e29b-41d4-a716-446655440000',
      currencyCode: 'USD',
      lineItems: [{ productName: 'A', quantity: '1' }],
    })
    expect(result.success).toBe(true)
  })

  it('returns error for invalid create_order payload', () => {
    const result = validateActionPayloadForType('create_order', {})
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('Invalid payload')
    }
  })

  it('passes for unknown action types', () => {
    const result = validateActionPayloadForType('unknown_type', { foo: 'bar' })
    expect(result.success).toBe(true)
  })

  it('validates draft_reply payload', () => {
    const result = validateActionPayloadForType('draft_reply', {
      to: 'john@example.com',
      subject: 'Re: Test',
      body: 'Reply body',
    })
    expect(result.success).toBe(true)
  })

  it('validates create_contact payload', () => {
    const result = validateActionPayloadForType('create_contact', {
      type: 'person',
      name: 'Test User',
    })
    expect(result.success).toBe(true)
  })

  it('returns formatted error messages', () => {
    const result = validateActionPayloadForType('create_contact', {
      type: 'invalid_type',
      name: '',
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error).toContain('create_contact')
    }
  })
})
