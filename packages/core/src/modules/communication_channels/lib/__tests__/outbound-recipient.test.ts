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

    // The guard exists to stop the recipient steering an adapter that
    // interpolates it into a REST path. A denylist of raw separators left the
    // encoded and control-byte variants of exactly that attack untouched, so the
    // allowlist's promise is pinned down here rather than left to the reader.
    it.each([
      ['a percent-encoded path separator', 'C123%2Fmessages'],
      ['a percent-encoded traversal', 'C123%2e%2e%2fusers%2f@me'],
      ['a bare percent sign', 'C123%'],
      ['a NUL byte', 'C123\u0000'],
      ['a DEL byte', 'C123\u007f'],
      ['a unit-separator control byte', 'C123\u001f'],
      ['a full URL', 'https://discord.com/api/channels/C123'],
      ['a comma-separated recipient list', 'C123,C456'],
    ])('rejects %s', (_label, recipient) => {
      expect(validateOutboundRecipient(recipient, providerNative)).toEqual({
        ok: false,
        error: 'Recipient may only contain letters, digits, and the characters . _ : @ + -',
      })
    })

    it.each([
      ['a plus-addressed email', 'qa+tag@example.com'],
      ['an underscored identifier', 'team_alerts'],
      ['a colon-namespaced identifier', 'workspace:C123'],
      ['a hyphenated identifier', 'general-chat'],
    ])('still accepts %s', (_label, recipient) => {
      expect(validateOutboundRecipient(recipient, providerNative)).toEqual({ ok: true })
    })
  })

  // The second half of #4976: a provider-native adapter is configured with its
  // own outbound target (Discord's `defaultChannelId`), so omitting the
  // recipient is how the documented smoke test addresses it. Before this, `to`
  // was mandatory on every provider and the credential field was written by the
  // connect dialog but read by no product path.
  describe('an omitted recipient', () => {
    it('is accepted on a provider-native provider, so the adapter default applies', () => {
      expect(validateOutboundRecipient(undefined, providerNative)).toEqual({ ok: true })
    })

    it.each([undefined, null, {}, { recipientFormat: 'email' as const }, baseEmailCapabilities])(
      'is still required on an email provider for capabilities %#',
      (capabilities) => {
        expect(validateOutboundRecipient(undefined, capabilities)).toEqual({
          ok: false,
          error: 'Recipient is required',
        })
      },
    )

    // Omission means `undefined` and nothing else. A caller that sent an
    // explicit empty or null recipient meant to address someone and got it
    // wrong; silently rerouting that to the provider default would deliver a
    // message somewhere the caller never named.
    it.each([
      ['an empty string', ''],
      ['null', null],
    ])('does not extend to %s on a provider-native provider', (_label, recipient) => {
      expect(validateOutboundRecipient(recipient, providerNative)).toEqual({
        ok: false,
        error: 'Recipient is required',
      })
    })
  })

  describe('shape guards, both formats', () => {
    it.each([
      ['an empty string', ''],
      ['a non-string', 42],
      ['null', null],
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
