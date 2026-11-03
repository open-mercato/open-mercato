import type { EntityManager } from '@mikro-orm/core'
import {
  nextDocumentVersion,
  preserveMonotonicDocumentVersionOnUpdate,
} from '../lib/versioning'

describe('documents optimistic-lock version allocation', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2020-01-01T00:00:00.000Z') })
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('strictly advances for same-millisecond and backwards-clock writes', () => {
    const current = new Date('2030-01-01T00:00:00.000Z')
    expect(nextDocumentVersion(current, new Date(current))).toEqual(
      new Date('2030-01-01T00:00:00.001Z'),
    )
    expect(nextDocumentVersion(current)).toEqual(new Date('2030-01-01T00:00:00.001Z'))
  })

  it('preserves a command-assigned monotonic token in the entity update hook', () => {
    const original = new Date('2030-01-01T00:00:00.000Z')
    const assigned = new Date('2030-01-01T00:00:00.001Z')
    const entity = { updatedAt: assigned }
    const em = {
      getUnitOfWork: () => ({ getOriginalEntityData: () => ({ updatedAt: original }) }),
    } as unknown as EntityManager

    expect(preserveMonotonicDocumentVersionOnUpdate(entity, em)).toBe(assigned)
  })

  it('allocates a new token when a write path did not assign one', () => {
    const original = new Date('2030-01-01T00:00:00.000Z')
    const entity = { updatedAt: new Date(original) }
    const em = {
      getUnitOfWork: () => ({ getOriginalEntityData: () => ({ updatedAt: original }) }),
    } as unknown as EntityManager

    expect(preserveMonotonicDocumentVersionOnUpdate(entity, em)).toEqual(
      new Date('2030-01-01T00:00:00.001Z'),
    )
  })
})
