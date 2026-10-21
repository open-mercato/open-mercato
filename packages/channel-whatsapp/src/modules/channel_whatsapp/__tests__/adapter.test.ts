/** @jest-environment node */
import {
  computeMetaSignature,
  verifyMetaSignature,
} from '../lib/webhook-signature'
import { normalizeInboundWhatsAppMessage } from '../lib/normalize-inbound'
import { convertOutboundForWhatsApp } from '../lib/convert-outbound'
import { getWhatsAppChannelAdapter } from '../lib/adapter'

const credentials = {
  accessToken: 'token',
  phoneNumberId: '123456',
  appSecret: 'secret',
  verifyToken: 'verify',
}

describe('WhatsApp webhook signatures', () => {
  it('accepts the exact HMAC and rejects tampering', () => {
    const body = '{"entry":[]}'
    const signature = computeMetaSignature(body, 'secret')
    expect(verifyMetaSignature(body, signature, 'secret')).toBe(true)
    expect(verifyMetaSignature(body, signature, 'other-secret')).toBe(false)
    expect(verifyMetaSignature('{"entry":[1]}', signature, 'secret')).toBe(false)
    expect(verifyMetaSignature(body, 'sha256=zz', 'secret')).toBe(false)
    expect(verifyMetaSignature(body, undefined, 'secret')).toBe(false)
  })
})

describe('WhatsApp inbound normalization', () => {
  it('normalizes a text message with the contact profile', () => {
    const normalized = normalizeInboundWhatsAppMessage({
      raw: {
        entry: [{
          changes: [{
            value: {
              metadata: { phone_number_id: '123456' },
              contacts: [{ profile: { name: 'Sara Omar' }, wa_id: '966500000000' }],
              messages: [{
                id: 'wamid.1',
                from: '966500000000',
                timestamp: '1700000000',
                type: 'text',
                text: { body: 'Hello' },
                context: { id: 'wamid.0' },
              }],
            },
          }],
        }],
      },
    })
    expect(normalized.externalMessageId).toBe('wamid.1')
    expect(normalized.externalConversationId).toBe('whatsapp:966500000000')
    expect(normalized.senderDisplayName).toBe('Sara Omar')
    expect(normalized.body).toBe('Hello')
    expect(normalized.replyToExternalId).toBe('wamid.0')
    expect(normalized.channelMetadata.whatsappPhoneNumberId).toBe('123456')
    expect(normalized.timestamp.toISOString()).toBe('2023-11-14T22:13:20.000Z')
  })

  it('normalizes a media message into an attachment placeholder', () => {
    const normalized = normalizeInboundWhatsAppMessage({
      raw: {
        entry: [{
          changes: [{
            value: {
              messages: [{
                id: 'wamid.2',
                from: '966500000000',
                timestamp: '1700000001',
                type: 'document',
                document: {
                  id: 'media-1',
                  mime_type: 'application/pdf',
                  filename: 'invoice.pdf',
                  caption: 'Invoice',
                },
              }],
            },
          }],
        }],
      },
    })
    expect(normalized.attachments).toHaveLength(1)
    expect(normalized.attachments?.[0]).toMatchObject({
      mimeType: 'application/pdf',
      fileName: 'invoice.pdf',
    })
    expect(normalized.body).toBe('Invoice')
  })
})

describe('WhatsApp outbound conversion', () => {
  it('keeps text-only messages text', () => {
    const native = convertOutboundForWhatsApp({ body: 'Hi', bodyFormat: 'text' })
    expect(native.metadata?.whatsappMessageType).toBe('text')
  })

  it('maps an attachment to its media type and caption', () => {
    const native = convertOutboundForWhatsApp({
      body: 'See attached',
      bodyFormat: 'text',
      attachments: [{ url: 'https://example.com/a.png', mimeType: 'image/png', fileName: 'a.png' }],
    })
    expect(native.metadata).toMatchObject({
      whatsappMessageType: 'image',
      whatsappMediaLink: 'https://example.com/a.png',
      whatsappMediaCaption: 'See attached',
    })
  })
})

describe('WhatsApp adapter send', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
  })

  it('posts a text message and returns the provider message id', async () => {
    const fetchMock = jest.fn(async () => new Response(
      JSON.stringify({ messages: [{ id: 'wamid.out.1' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    global.fetch = fetchMock as unknown as typeof fetch

    const result = await getWhatsAppChannelAdapter().sendMessage({
      credentials,
      content: { text: 'Hello', bodyFormat: 'text' },
      metadata: { to: '966500000000' },
      scope: { tenantId: 't', organizationId: 'o' },
    })

    expect(result).toMatchObject({
      externalMessageId: 'wamid.out.1',
      conversationId: 'whatsapp:966500000000',
      status: 'sent',
    })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://graph.facebook.com/v20.0/123456/messages')
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      messaging_product: 'whatsapp',
      to: '966500000000',
      type: 'text',
      text: { body: 'Hello', preview_url: false },
    })
  })

  it('sends a template message when one is supplied', async () => {
    const fetchMock = jest.fn(async () => new Response(
      JSON.stringify({ messages: [{ id: 'wamid.out.2' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ))
    global.fetch = fetchMock as unknown as typeof fetch

    await getWhatsAppChannelAdapter().sendMessage({
      credentials,
      content: { text: 'ignored', bodyFormat: 'text' },
      metadata: {
        to: '966500000000',
        template: { name: 'order_update', languageCode: 'ar', components: [] },
      },
      scope: { tenantId: 't', organizationId: 'o' },
    })

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      type: 'template',
      template: { name: 'order_update', language: { code: 'ar' }, components: [] },
    })
  })

  it('reports requires_reauth on a 401', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch
    const result = await getWhatsAppChannelAdapter().sendMessage({
      credentials,
      content: { text: 'Hello', bodyFormat: 'text' },
      metadata: { to: '966500000000' },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result).toMatchObject({ status: 'failed', error: 'requires_reauth' })
  })

  it('fails legibly without a recipient', async () => {
    const result = await getWhatsAppChannelAdapter().sendMessage({
      credentials,
      content: { text: 'Hello', bodyFormat: 'text' },
      scope: { tenantId: 't', organizationId: 'o' },
    })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('No WhatsApp recipient')
  })
})
