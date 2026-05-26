import type { GraphMessage } from '../graph-client'
import { normalizeInboundMicrosoftMessage } from '../normalize-inbound'

describe('normalizeInboundMicrosoftMessage', () => {
  function buildMessage(overrides: Partial<GraphMessage> = {}): GraphMessage {
    return {
      id: 'gm-msg-1',
      conversationId: 'conv-1',
      internetMessageId: '<rfc@example.com>',
      subject: 'Hi',
      receivedDateTime: '2026-05-21T10:00:00.000Z',
      from: { emailAddress: { address: 'alice@outlook.com', name: 'Alice' } },
      toRecipients: [{ emailAddress: { address: 'bob@example.com' } }],
      body: { contentType: 'html', content: '<p>hi</p>' },
      categories: ['Pink', 'Follow up'],
      inferenceClassification: 'focused',
      ...overrides,
    }
  }

  it('uses Microsoft conversationId for externalConversationId, not the RFC2822 root', async () => {
    const result = await normalizeInboundMicrosoftMessage({
      message: buildMessage(),
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('rfc@example.com')
    expect(result.externalConversationId).toBe('microsoft-conversation:conv-1')
    expect(result.bodyFormat).toBe('html')
    expect(result.body).toContain('<p>hi</p>')
    expect(result.senderDisplayName).toBe('Alice')
  })

  it('falls back to a synthetic message id when internetMessageId is missing', async () => {
    const result = await normalizeInboundMicrosoftMessage({
      message: buildMessage({ internetMessageId: undefined }),
      accountIdentifier: 'bob@example.com',
    })
    expect(result.externalMessageId).toBe('microsoft:gm-msg-1@bob@example.com')
  })

  it('falls back to text body format when content-type is text', async () => {
    const result = await normalizeInboundMicrosoftMessage({
      message: buildMessage({ body: { contentType: 'text', content: 'plain body' } }),
      accountIdentifier: 'bob@example.com',
    })
    expect(result.bodyFormat).toBe('text')
    expect(result.body).toBe('plain body')
  })

  it('exposes microsoft-specific metadata for downstream widgets', async () => {
    const result = await normalizeInboundMicrosoftMessage({
      message: buildMessage({ categories: ['Pink'], inferenceClassification: 'other' }),
      accountIdentifier: 'bob@example.com',
    })
    expect((result.channelPayload as { categories: string[] }).categories).toEqual(['Pink'])
    expect((result.channelPayload as { inferenceClassification: string }).inferenceClassification).toBe('other')
    expect((result.channelPayload as { microsoftConversationId: string }).microsoftConversationId).toBe('conv-1')
  })
})
