import { resolveTestSendRecipient } from '../outbound-recipient'

describe('resolveTestSendRecipient (#4976)', () => {
  describe('email-typed channels keep the pre-#4976 contract', () => {
    it('accepts an address', () => {
      expect(resolveTestSendRecipient('email', 'jane@example.com')).toEqual({
        ok: true,
        to: 'jane@example.com',
      })
    })

    it('rejects a missing recipient', () => {
      expect(resolveTestSendRecipient('email', undefined)).toEqual({
        ok: false,
        error: 'to is required for an email channel',
      })
    })

    it('rejects a recipient that is not an address', () => {
      // The exact input QA sent for Discord, which used to be the only thing a
      // caller could send and the one thing the route refused.
      expect(resolveTestSendRecipient('email', '1534331920463433771')).toEqual({
        ok: false,
        error: 'Invalid email address',
      })
    })

    it('rejects whitespace-only input rather than passing it to the adapter', () => {
      expect(resolveTestSendRecipient('email', '   ').ok).toBe(false)
    })
  })

  describe('recognized non-email channels take a provider-native identifier', () => {
    it('accepts a Discord channel snowflake', () => {
      expect(resolveTestSendRecipient('discord', '1534331920463433771')).toEqual({
        ok: true,
        to: '1534331920463433771',
      })
    })

    it('accepts no recipient at all, leaving the adapter its configured default', () => {
      // This is the documented smoke test: `Default channel ID` is described as
      // "default text channel for outbound sends and the test-send smoke test",
      // and before #4976 there was no request shape that could reach it.
      expect(resolveTestSendRecipient('discord', undefined)).toEqual({ ok: true, to: undefined })
      expect(resolveTestSendRecipient('discord', '  ')).toEqual({ ok: true, to: undefined })
    })

    it('trims a recipient it does accept', () => {
      expect(resolveTestSendRecipient('slack', ' C0123456789 ')).toEqual({
        ok: true,
        to: 'C0123456789',
      })
    })
  })

  describe('fails closed on anything it does not positively recognize', () => {
    it.each([undefined, null, '', '   ', 'e-mail', 'discrod'])(
      'keeps the address requirement for channel type %p',
      (channelType) => {
        expect(resolveTestSendRecipient(channelType, '1534331920463433771').ok).toBe(false)
        expect(resolveTestSendRecipient(channelType, 'jane@example.com')).toEqual({
          ok: true,
          to: 'jane@example.com',
        })
      },
    )
  })
})
