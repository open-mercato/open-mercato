import { signWebhookPayload } from '../sign'
import { verifyWebhookSignature } from '../verify'
import { generateWebhookSecret } from '../secrets'

describe('verifyWebhookSignature', () => {
  const msgId = 'msg_test123'
  const body = '{"type":"test.event","data":{}}'

  it('verifies a valid signature', () => {
    const secret = generateWebhookSecret()
    const now = Math.floor(Date.now() / 1000)
    const sig = signWebhookPayload(msgId, now, body, secret)
    const result = verifyWebhookSignature(msgId, String(now), body, sig, [secret])
    expect(result.valid).toBe(true)
    expect(result.matchedKeyIndex).toBe(0)
  })

  it('rejects an invalid signature', () => {
    const secret = generateWebhookSecret()
    const otherSecret = generateWebhookSecret()
    const now = Math.floor(Date.now() / 1000)
    const sig = signWebhookPayload(msgId, now, body, secret)
    const result = verifyWebhookSignature(msgId, String(now), body, sig, [otherSecret])
    expect(result.valid).toBe(false)
  })

  it('rejects expired timestamps', () => {
    const secret = generateWebhookSecret()
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600
    const sig = signWebhookPayload(msgId, oldTimestamp, body, secret)
    const result = verifyWebhookSignature(msgId, String(oldTimestamp), body, sig, [secret])
    expect(result.valid).toBe(false)
  })

  it('matches the correct key during rotation', () => {
    const oldSecret = generateWebhookSecret()
    const newSecret = generateWebhookSecret()
    const now = Math.floor(Date.now() / 1000)
    const sig = signWebhookPayload(msgId, now, body, oldSecret)
    const result = verifyWebhookSignature(msgId, String(now), body, sig, [newSecret, oldSecret])
    expect(result.valid).toBe(true)
    expect(result.matchedKeyIndex).toBe(1)
  })
})
