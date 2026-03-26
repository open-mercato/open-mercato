import { signWebhookPayload, buildWebhookHeaders, generateMessageId } from '../sign'
import { generateWebhookSecret } from '../secrets'

describe('signWebhookPayload', () => {
  it('produces a v1 prefixed signature', () => {
    const secret = generateWebhookSecret()
    const sig = signWebhookPayload('msg_test', 1700000000, '{"test":true}', secret)
    expect(sig).toMatch(/^v1,.+$/)
  })

  it('produces deterministic signatures for same inputs', () => {
    const secret = generateWebhookSecret()
    const sig1 = signWebhookPayload('msg_test', 1700000000, '{"test":true}', secret)
    const sig2 = signWebhookPayload('msg_test', 1700000000, '{"test":true}', secret)
    expect(sig1).toBe(sig2)
  })

  it('produces different signatures for different payloads', () => {
    const secret = generateWebhookSecret()
    const sig1 = signWebhookPayload('msg_test', 1700000000, '{"a":1}', secret)
    const sig2 = signWebhookPayload('msg_test', 1700000000, '{"a":2}', secret)
    expect(sig1).not.toBe(sig2)
  })
})

describe('buildWebhookHeaders', () => {
  it('returns standard webhook headers', () => {
    const secret = generateWebhookSecret()
    const headers = buildWebhookHeaders('msg_abc', 1700000000, '{}', secret)
    expect(headers['webhook-id']).toBe('msg_abc')
    expect(headers['webhook-timestamp']).toBe('1700000000')
    expect(headers['webhook-signature']).toMatch(/^v1,.+$/)
  })

  it('includes dual signatures during key rotation', () => {
    const secret = generateWebhookSecret()
    const prevSecret = generateWebhookSecret()
    const headers = buildWebhookHeaders('msg_abc', 1700000000, '{}', secret, prevSecret)
    const sigs = headers['webhook-signature'].split(' ')
    expect(sigs).toHaveLength(2)
    expect(sigs[0]).toMatch(/^v1,.+$/)
    expect(sigs[1]).toMatch(/^v1,.+$/)
    expect(sigs[0]).not.toBe(sigs[1])
  })
})

describe('generateMessageId', () => {
  it('returns msg_ prefixed string', () => {
    const id = generateMessageId()
    expect(id).toMatch(/^msg_[0-9a-f]{32}$/)
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateMessageId()))
    expect(ids.size).toBe(100)
  })
})
