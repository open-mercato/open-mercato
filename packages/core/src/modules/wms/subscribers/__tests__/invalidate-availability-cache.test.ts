import { matchEventPattern } from '@open-mercato/shared/lib/events/patterns'
import { WMS_AVAILABILITY_CACHE_TAG } from '../../lib/availabilityCache'
import balanceSubscriber, { metadata as balanceMetadata } from '../invalidate-availability-cache'
import policySubscriber, { metadata as policyMetadata } from '../invalidate-availability-cache-policy'
import profileSubscriber, { metadata as profileMetadata } from '../invalidate-availability-cache-profile'

function makeContext() {
  const deleteByTags = jest.fn().mockResolvedValue(1)
  const cache = { get: jest.fn(), set: jest.fn(), deleteByTags }
  return {
    deleteByTags,
    ctx: {
      resolve: <T,>(name: string): T => {
        if (name === 'cache') return cache as unknown as T
        throw new Error(`not registered: ${name}`)
      },
    },
  }
}

describe('wms availability cache invalidation subscribers', () => {
  it.each([
    ['inventory balance', balanceSubscriber, balanceMetadata.event, 'wms.inventory_balance.updated'],
    ['availability policy', policySubscriber, policyMetadata.event, 'availability.policy.updated'],
    ['inventory profile', profileSubscriber, profileMetadata.event, 'wms.inventory_profile.updated'],
  ])('drops the tenant availability cache when an %s changes', async (_label, subscriber, pattern, eventId) => {
    expect(matchEventPattern(eventId, pattern)).toBe(true)
    const { ctx, deleteByTags } = makeContext()
    await subscriber({ id: 'record-1', tenantId: 'tenant-1', organizationId: 'org-1' }, ctx)
    expect(deleteByTags).toHaveBeenCalledWith([WMS_AVAILABILITY_CACHE_TAG])
  })

  it('registers a distinct subscriber id per event pattern', () => {
    const ids = [balanceMetadata.id, policyMetadata.id, profileMetadata.id]
    expect(new Set(ids).size).toBe(ids.length)
  })
})
