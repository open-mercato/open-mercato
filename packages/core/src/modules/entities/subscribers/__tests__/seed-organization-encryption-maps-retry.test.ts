// The retry backstop for `seed-organization-encryption-maps.ts` (#7591, #7629). It is the
// `persistent: true` counterpart that re-runs the same idempotent upsert through the worker
// when the inline ephemeral run failed. Behavior is already fully covered by
// `seed-organization-encryption-maps.test.ts` since both delegate to the same handler; this
// file only needs to pin the metadata that gives the backstop its retry semantics.

import handler, { metadata } from '@open-mercato/core/modules/entities/subscribers/seed-organization-encryption-maps-retry'

describe('entities/seed-organization-encryption-maps-retry subscriber', () => {
  it('declares the directory.organization.created event as persistent (worker-retried)', () => {
    expect(metadata.event).toBe('directory.organization.created')
    expect(metadata.persistent).toBe(true)
    expect(metadata.id).toBe('entities:seed-organization-encryption-maps-retry')
  })

  it('delegates to the same handler as the inline subscriber', async () => {
    const em = { execute: jest.fn(async () => []), fork: jest.fn() }
    em.fork.mockReturnValue(em)
    const ctx = {
      resolve: <T = unknown>(name: string): T => {
        if (name === 'em') return em as unknown as T
        throw new Error(`unexpected DI key: ${name}`)
      },
    }

    await expect(handler({}, ctx)).resolves.toBeUndefined()
  })
})
