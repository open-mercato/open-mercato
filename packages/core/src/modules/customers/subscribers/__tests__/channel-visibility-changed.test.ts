import handler, { metadata } from '../channel-visibility-changed'
import { buildPersonDetailCacheTags } from '../../lib/personDetailCacheTags'

/**
 * Flipping a whole mailbox's visibility changes which email rows the
 * person-detail read filter admits without writing any resource the cached
 * payload's tags observe, so this subscriber is the only thing that clears it.
 * The revoke direction is the one that matters: a teammate must not keep
 * reading now-private email out of a warm cache entry.
 */

function makeCtx(cache: unknown) {
  return { resolve: jest.fn().mockReturnValue(cache) as unknown as <T>(name: string) => T }
}

const payload = {
  channelId: 'c1',
  userId: 'u1',
  actorUserId: 'u1',
  previousVisibility: 'shared',
  nextVisibility: 'private',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

describe('customers subscriber: communication_channels.channel.visibility_changed', () => {
  it('subscribes to the hub event the set-visibility command emits', () => {
    expect(metadata.event).toBe('communication_channels.channel.visibility_changed')
    expect(metadata.id).toBe('customers:channel-visibility-changed')
  })

  it('is ephemeral, so the invalidation runs inline instead of waiting on the events worker', () => {
    // Under single-delivery a persistent subscriber runs ONLY in the worker,
    // which would leave the stale entry readable until the queue drains.
    expect(metadata.persistent).toBe(false)
  })

  it('invalidates the person-detail collection tags for the event scope', async () => {
    const invalidateTags = jest.fn().mockResolvedValue(undefined)
    await handler(payload, makeCtx({ invalidateTags }))

    expect(invalidateTags).toHaveBeenCalledTimes(1)
    expect(invalidateTags).toHaveBeenCalledWith(buildPersonDetailCacheTags('tenant-1', 'org-1'))
    // The interaction tags are the ones the widened/narrowed email rows live under.
    expect(invalidateTags.mock.calls[0][0].some((tag: string) => tag.includes('customers.interaction'))).toBe(true)
  })

  it('passes a null organization through rather than inventing a scope', async () => {
    const invalidateTags = jest.fn().mockResolvedValue(undefined)
    await handler({ ...payload, organizationId: null }, makeCtx({ invalidateTags }))
    expect(invalidateTags).toHaveBeenCalledWith(buildPersonDetailCacheTags('tenant-1', null))
  })

  it('fails closed on a payload with no tenant instead of clearing an unscoped tag set', async () => {
    const invalidateTags = jest.fn().mockResolvedValue(undefined)
    await handler({ ...payload, tenantId: undefined }, makeCtx({ invalidateTags }))
    expect(invalidateTags).not.toHaveBeenCalled()
  })

  it('does not throw when no cache is registered', async () => {
    await expect(handler(payload, makeCtx(undefined))).resolves.toBeUndefined()
  })

  it('swallows a cache failure — the channel write is already committed', async () => {
    const invalidateTags = jest.fn().mockRejectedValue(new Error('cache down'))
    await expect(handler(payload, makeCtx({ invalidateTags }))).resolves.toBeUndefined()
  })
})
