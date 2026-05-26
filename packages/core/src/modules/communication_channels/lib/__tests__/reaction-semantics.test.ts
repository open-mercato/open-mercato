import {
  allowsMultipleReactionsPerUser,
  resolveInboundAddMutation,
} from '../reaction-semantics'
import type { ChannelCapabilities } from '../adapter'

describe('allowsMultipleReactionsPerUser', () => {
  it('returns true when capability is explicitly true', () => {
    expect(
      allowsMultipleReactionsPerUser({
        multiReactionPerUser: true,
      } as ChannelCapabilities),
    ).toBe(true)
  })

  it('returns false when capability is explicitly false', () => {
    expect(
      allowsMultipleReactionsPerUser({
        multiReactionPerUser: false,
      } as ChannelCapabilities),
    ).toBe(false)
  })

  it('returns false when capability is undefined (fail-safe)', () => {
    expect(allowsMultipleReactionsPerUser({} as ChannelCapabilities)).toBe(false)
  })

  it('returns false for null/undefined capabilities object', () => {
    expect(allowsMultipleReactionsPerUser(null)).toBe(false)
    expect(allowsMultipleReactionsPerUser(undefined)).toBe(false)
  })
})

describe('resolveInboundAddMutation', () => {
  it('returns "insert" for Slack-like capabilities (multiReactionPerUser=true)', () => {
    expect(
      resolveInboundAddMutation({
        multiReactionPerUser: true,
      } as ChannelCapabilities),
    ).toBe('insert')
  })

  it('returns "replace" for WhatsApp-like capabilities (multiReactionPerUser=false)', () => {
    expect(
      resolveInboundAddMutation({
        multiReactionPerUser: false,
      } as ChannelCapabilities),
    ).toBe('replace')
  })

  it('defaults to "replace" when capability missing (safer default)', () => {
    expect(resolveInboundAddMutation(null)).toBe('replace')
    expect(resolveInboundAddMutation(undefined)).toBe('replace')
    expect(resolveInboundAddMutation({} as ChannelCapabilities)).toBe('replace')
  })
})
