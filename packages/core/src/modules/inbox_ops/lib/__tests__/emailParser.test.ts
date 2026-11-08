/** @jest-environment node */

import type { ResendInboundAttachment } from '../../data/validators'
import { parseInboundEmail } from '../emailParser'
import { nonDecorativeInboundAttachmentIds } from '../inboundAttachments'

describe('parseInboundEmail', () => {
  it('parses basic email fields', () => {
    const result = parseInboundEmail({
      from: 'John Doe <john@example.com>',
      to: 'ops@inbox.mercato.local',
      subject: 'New order request',
      text: 'Please create an order for 10 widgets.',
      messageId: '<msg-001@example.com>',
    })

    expect(result.from).toEqual({ name: 'John Doe', email: 'john@example.com' })
    expect(result.subject).toBe('New order request')
    expect(result.messageId).toBe('<msg-001@example.com>')
    expect(result.cleanedText).toContain('Please create an order')
    expect(result.contentHash).toBeTruthy()
    expect(typeof result.contentHash).toBe('string')
  })

  it('handles missing subject with fallback', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Some text',
    })

    expect(result.subject).toBe('(no subject)')
  })

  it('parses email address without display name', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Hello',
    })

    expect(result.from).toEqual({ email: 'john@example.com' })
    expect(result.from.name).toBeUndefined()
  })

  it('strips HTML to extract text when no plain text provided', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      html: '<p>Hello <b>World</b></p><style>.foo{}</style><script>alert(1)</script>',
    })

    expect(result.cleanedText).toContain('Hello World')
    expect(result.cleanedText).not.toContain('<p>')
    expect(result.cleanedText).not.toContain('<style>')
    expect(result.cleanedText).not.toContain('alert')
  })

  it('strips signatures from email body', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Please place the order.\n\n--\nJohn Doe\nSales Manager',
    })

    expect(result.cleanedText).toContain('Please place the order')
    expect(result.cleanedText).not.toContain('Sales Manager')
  })

  it('strips "Sent from" signature patterns', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Order confirmed.\n\nSent from my iPhone',
    })

    expect(result.cleanedText).toContain('Order confirmed')
    expect(result.cleanedText).not.toContain('Sent from')
  })

  it('strips quoted replies', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Yes, confirmed.\n\nOn Jan 15, 2026, Alice wrote:\n> Please confirm your order.\n> Regards,\n> Alice',
    })

    expect(result.cleanedText).toContain('Yes, confirmed')
    expect(result.cleanedText).not.toContain('Please confirm your order')
  })

  it('generates consistent content hash for same input', () => {
    const payload = {
      from: 'john@example.com',
      subject: 'Order',
      text: 'Some content here',
    }

    const result1 = parseInboundEmail(payload)
    const result2 = parseInboundEmail(payload)

    expect(result1.contentHash).toBe(result2.contentHash)
    expect(result1.contentHash).toHaveLength(64) // SHA-256 hex
  })

  it('generates different hashes for different content', () => {
    const result1 = parseInboundEmail({ from: 'a@b.com', subject: 'A', text: 'Hello' })
    const result2 = parseInboundEmail({ from: 'a@b.com', subject: 'B', text: 'Hello' })

    expect(result1.contentHash).not.toBe(result2.contentHash)
  })

  it('handles empty body gracefully', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      subject: 'Empty',
    })

    expect(result.cleanedText).toBe('')
    expect(result.threadMessages).toHaveLength(1)
    expect(result.rawText).toBeNull()
    expect(result.rawHtml).toBeNull()
  })

  it('parses multiple recipients', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      to: ['ops@inbox.mercato.local', 'Alice <alice@example.com>'],
      text: 'Hello',
    })

    expect(result.to).toHaveLength(2)
    expect(result.to[0].email).toBe('ops@inbox.mercato.local')
    expect(result.to[1]).toEqual({ name: 'Alice', email: 'alice@example.com' })
  })

  it('preserves raw text and html', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Raw text content',
      html: '<p>Raw HTML</p>',
    })

    expect(result.rawText).toBe('Raw text content')
    expect(result.rawHtml).toBe('<p>Raw HTML</p>')
  })

  it('parses references as array', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Hello',
      references: '<ref-1@example.com> <ref-2@example.com>',
      inReplyTo: '<ref-2@example.com>',
      replyTo: 'reply@example.com',
    })

    expect(result.references).toEqual(['<ref-1@example.com>', '<ref-2@example.com>'])
    expect(result.inReplyTo).toBe('<ref-2@example.com>')
    expect(result.replyTo).toBe('reply@example.com')
  })

  it('splits forwarded message threads', () => {
    const text = [
      'Please process this order.',
      '',
      '---------- Forwarded message ----------',
      'From: Alice <alice@example.com>',
      '',
      'We need 100 units of Widget A.',
    ].join('\n')

    const result = parseInboundEmail({
      from: 'john@example.com',
      text,
    })

    expect(result.threadMessages.length).toBeGreaterThanOrEqual(1)
    expect(result.threadMessages[0].from.email).toBe('john@example.com')
  })

  it('normalizes whitespace', () => {
    const result = parseInboundEmail({
      from: 'john@example.com',
      text: 'Line 1\r\nLine 2\r\n\r\n\r\n\r\nLine 3',
    })

    expect(result.cleanedText).not.toContain('\r')
    expect(result.cleanedText).not.toMatch(/\n{3,}/)
  })

  it('handles quoted display names', () => {
    const result = parseInboundEmail({
      from: '"Doe, John" <john@example.com>',
      text: 'Hello',
    })

    expect(result.from).toEqual({ name: 'Doe, John', email: 'john@example.com' })
  })
})

describe('parseInboundEmail contentHash with attachments', () => {
  const inlineImageMinBytes = 16 * 1024
  const envelope = { from: 'Supplier <offers@supplier.example>', subject: 'Offer', text: 'Please find our offer attached.' }
  const attachmentOnlyEnvelope = { from: 'offers@supplier.example', subject: 'Offer' }

  function file(id: string): ResendInboundAttachment {
    return { id, filename: 'offer.pdf', size: 48_213, content_type: 'application/pdf', content_id: null, content_disposition: 'attachment' }
  }

  function logo(id: string): ResendInboundAttachment {
    return { id, filename: 'logo.png', size: 2_048, content_type: 'image/png', content_id: `<${id}@mail>`, content_disposition: 'inline' }
  }

  function hashOf(payload: Parameters<typeof parseInboundEmail>[0], parts?: ResendInboundAttachment[]): string {
    const attachmentIds = parts ? nonDecorativeInboundAttachmentIds(parts, { inlineImageMinBytes }) : undefined
    return parseInboundEmail(payload, attachmentIds ? { attachmentIds } : undefined).contentHash
  }

  it('keeps the existing hash byte-identical for mail without attachments', () => {
    expect(hashOf(envelope)).toBe('8070f90f5892b8ce5a75e9e89cca8c4bdbf47d181670c1ecb1e01902d559a3ec')
    expect(hashOf(attachmentOnlyEnvelope)).toBe('48a08f5b743a1a052c1c7dfaa9eaf7754f455f2f7eccac75cd06cf2289f1319b')
    expect(hashOf(envelope, [])).toBe(hashOf(envelope))
    expect(parseInboundEmail(envelope, { attachmentIds: [] }).contentHash).toBe(hashOf(envelope))
  })

  it('keeps the existing hash for mail whose only parts are inline logos', () => {
    expect(hashOf(envelope, [logo('logo-1'), logo('logo-2')])).toBe(hashOf(envelope))
  })

  it('distinguishes attachment-only emails from the same envelope without files', () => {
    expect(hashOf(attachmentOnlyEnvelope, [file('att-1')])).not.toBe(hashOf(attachmentOnlyEnvelope))
  })

  it('gives different hashes to attachment-only emails with equal metadata but different attachment ids', () => {
    const first = hashOf(attachmentOnlyEnvelope, [file('2f0d1b6e-0001-4000-8000-000000000001')])
    const second = hashOf(attachmentOnlyEnvelope, [file('2f0d1b6e-0002-4000-8000-000000000002')])
    expect(first).not.toBe(second)
  })

  it('gives equal hashes to the same envelope delivered twice, whatever the part order', () => {
    const parts = [logo('logo-1'), file('att-b'), file('att-a')]
    expect(hashOf(attachmentOnlyEnvelope, parts)).toBe(hashOf(attachmentOnlyEnvelope, [file('att-a'), logo('logo-1'), file('att-b')]))
    expect(hashOf(attachmentOnlyEnvelope, parts)).toBe(hashOf(attachmentOnlyEnvelope, parts))
  })

  it('ignores inline logos next to real attachments', () => {
    expect(hashOf(envelope, [logo('logo-1'), file('att-1')])).toBe(hashOf(envelope, [file('att-1')]))
  })
})
