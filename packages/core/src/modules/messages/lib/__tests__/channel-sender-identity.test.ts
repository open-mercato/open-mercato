import {
  channelTypeRequiresExternalEmail,
  listNonEmailSenderChannelTypes,
} from '../channel-sender-identity'

describe('channelTypeRequiresExternalEmail (#4975)', () => {
  it('requires an address for email-typed channels', () => {
    expect(channelTypeRequiresExternalEmail('email')).toBe(true)
  })

  it('waives the requirement for every recognized non-email channel type', () => {
    for (const channelType of listNonEmailSenderChannelTypes()) {
      expect(channelTypeRequiresExternalEmail(channelType)).toBe(false)
    }
  })

  it('normalizes casing and surrounding whitespace', () => {
    expect(channelTypeRequiresExternalEmail('  Discord ')).toBe(false)
    expect(channelTypeRequiresExternalEmail('DISCORD')).toBe(false)
  })

  it('fails closed for an absent channel type', () => {
    expect(channelTypeRequiresExternalEmail(undefined)).toBe(true)
    expect(channelTypeRequiresExternalEmail(null)).toBe(true)
    expect(channelTypeRequiresExternalEmail('')).toBe(true)
    expect(channelTypeRequiresExternalEmail('   ')).toBe(true)
  })

  it('fails closed for an unrecognized channel type', () => {
    // A typo or a provider the hub has never heard of must not silently switch
    // a validation rule off — it keeps the pre-#4975 behaviour instead.
    expect(channelTypeRequiresExternalEmail('discrod')).toBe(true)
    expect(channelTypeRequiresExternalEmail('carrier-pigeon')).toBe(true)
  })
})
