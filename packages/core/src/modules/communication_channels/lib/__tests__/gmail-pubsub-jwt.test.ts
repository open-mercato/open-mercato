import { decodeGmailPubSubBody, GmailPubSubJwtError } from '../gmail-pubsub-jwt'

describe('decodeGmailPubSubBody', () => {
  it('decodes a valid Pub/Sub envelope', () => {
    const inner = { emailAddress: 'alice@example.com', historyId: '12345' }
    const data = Buffer.from(JSON.stringify(inner), 'utf-8').toString('base64')
    const envelope = JSON.stringify({
      message: { data, messageId: 'm1', publishTime: '2026-05-27T00:00:00Z' },
      subscription: 'projects/p/subscriptions/s',
    })
    const result = decodeGmailPubSubBody(envelope)
    expect(result.emailAddress).toBe('alice@example.com')
    expect(String(result.historyId)).toBe('12345')
  })

  it('rejects non-JSON bodies', () => {
    expect(() => decodeGmailPubSubBody('not-json')).toThrow(GmailPubSubJwtError)
  })

  it('rejects envelopes missing message.data', () => {
    const envelope = JSON.stringify({ message: { messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/message\.data/)
  })

  it('rejects payloads missing emailAddress', () => {
    const data = Buffer.from(JSON.stringify({ historyId: '1' }), 'utf-8').toString('base64')
    const envelope = JSON.stringify({ message: { data, messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/emailAddress/)
  })

  it('rejects payloads missing historyId', () => {
    const data = Buffer.from(JSON.stringify({ emailAddress: 'a@b.c' }), 'utf-8').toString('base64')
    const envelope = JSON.stringify({ message: { data, messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(/historyId/)
  })

  it('rejects non-base64 message.data', () => {
    // Stringified array that JSON.parse-decodes but throws downstream when parsed as JSON
    const envelope = JSON.stringify({ message: { data: '!!!not-base64!!!', messageId: 'm1' } })
    expect(() => decodeGmailPubSubBody(envelope)).toThrow(GmailPubSubJwtError)
  })
})
