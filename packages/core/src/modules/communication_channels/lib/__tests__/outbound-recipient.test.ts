import {
  MAX_OUTBOUND_RECIPIENT_LENGTH,
  validateOutboundRecipient,
} from '../outbound-recipient'
import { baseEmailCapabilities } from '../email-capabilities'

const providerNative = { recipientFormat: 'provider-native' as const }

describe('validateOutboundRecipient', () => {
  describe('email providers (default and explicit)', () => {
    it.each([undefined, null, {}, { recipientFormat: 'email' as const }, baseEmailCapabilities])(
      'accepts an address and rejects a non-address for capabilities %#',
      (capabilities) => {
        expect(validateOutboundRecipient('qa@example.com', capabilities)).toEqual({ ok: true })
        expect(validateOutboundRecipient('1534331920463433771', capabilities)).toEqual({
          ok: false,
          error: 'Recipient must be a valid email address',
        })
      },
    )
  })

  describe('provider-native providers', () => {
    // The reason this helper exists: #4976 — a Discord channel snowflake had no
    // way through the hub because every outbound endpoint hard-wired an email.
    it('accepts a Discord channel snowflake', () => {
      expect(validateOutboundRecipient('1534331920463433771', providerNative)).toEqual({ ok: true })
    })

    it('accepts an email address too — widening never narrows', () => {
      expect(validateOutboundRecipient('qa@example.com', providerNative)).toEqual({ ok: true })
    })

    it.each([
      ['a CR/LF header injection attempt', 'C123\r\nBcc: attacker@example.com'],
      ['a bare newline', 'C123\nC456'],
      ['whitespace', 'C123 C456'],
      ['a path separator', 'C123/messages'],
      ['a backslash', 'C123\\messages'],
      ['a query string', 'C123?limit=100'],
      ['a fragment', 'C123#frag'],
      ['a traversal segment', '..'],
    ])('rejects %s', (_label, recipient) => {
      expect(validateOutboundRecipient(recipient, providerNative).ok).toBe(false)
    })
  })

  describe('shape guards, both formats', () => {
    it.each([
      ['an empty string', ''],
      ['a non-string', 42],
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s', (_label, recipient) => {
      expect(validateOutboundRecipient(recipient, providerNative)).toEqual({
        ok: false,
        error: 'Recipient is required',
      })
    })

    it('rejects a recipient over the length ceiling', () => {
      const tooLong = 'x'.repeat(MAX_OUTBOUND_RECIPIENT_LENGTH + 1)
      expect(validateOutboundRecipient(tooLong, providerNative)).toEqual({
        ok: false,
        error: `Recipient must be at most ${MAX_OUTBOUND_RECIPIENT_LENGTH} characters`,
      })
    })
  })
})
