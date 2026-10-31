const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { User } from '@open-mercato/core/modules/auth/data/entities'
import { resolveOrBuildRepParticipant } from '../participants'

// Regression: `User.name`/`email` are encrypted (auth:user). The rep participant's
// `displayName` is written ONCE as a snapshot (itself encrypted) and never re-derived, so
// resolving it from a plain `em.findOne` would permanently bake the ciphertext in. Must go
// through `findOneWithDecryption`, scoped to the thread's own tenant/organization.
describe('resolveOrBuildRepParticipant — display name decryption', () => {
  beforeEach(() => {
    mockFindOneWithDecryption.mockReset()
  })

  it('builds the participant with the decrypted user name, via findOneWithDecryption', async () => {
    mockFindOneWithDecryption.mockResolvedValue({ id: 'rep-1', name: 'Rep One', email: 'rep1@example.com' })
    const em = {
      findOne: jest.fn(async () => null),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    } as unknown as EntityManager
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1', threadId: 'thread-1' }

    const { participant, isNew } = await resolveOrBuildRepParticipant(em, scope, 'rep-1')

    expect(isNew).toBe(true)
    expect(participant.displayName).toBe('Rep One')
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      User,
      { id: 'rep-1' },
      {},
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('falls back to the actor id when the user has neither a decrypted name nor email', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)
    const em = {
      findOne: jest.fn(async () => null),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => data),
    } as unknown as EntityManager
    const scope = { tenantId: 'tenant-1', organizationId: 'org-1', threadId: 'thread-1' }

    const { participant } = await resolveOrBuildRepParticipant(em, scope, 'rep-missing')
    expect(participant.displayName).toBe('[internal] staff user rep-missing')
  })
})
