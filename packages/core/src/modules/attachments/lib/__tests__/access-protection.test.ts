import type { EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentPartition } from '../../data/entities'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  ensureAttachmentPartitionProtection,
  getDeclaredAttachmentAccessRequirements,
  getDeclaredLibraryExcludedEntities,
  getInitialLibraryExcludedEntities,
  mergeAttachmentAccessRequirements,
  mergeLibraryExcludedEntities,
  resolveLibraryExcludedEntities,
  syncAttachmentAccessProtection,
} from '../access-protection'
import { registerAttachmentAccessResolvers } from '../access-registry'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(), findOneWithDecryption: jest.fn(),
}))
jest.mock('../../data/entities', () => ({ AttachmentPartition: class AttachmentPartition {} }))

const documentRequirement = { resolverId: 'documents.files', targetEntity: 'documents:document' }
const otherRequirement = { resolverId: 'clinical.files', targetEntity: 'clinical.patient' }

beforeEach(() => {
  jest.clearAllMocks()
  registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [], protectedTargets: [
    { ...documentRequirement, targetPartition: '*' },
  ] }])
})
afterEach(() => registerAttachmentAccessResolvers([]))

it('preserves an existing requirement while adding an idempotent owner-selective rule', () => {
  const merged = mergeAttachmentAccessRequirements([otherRequirement], [documentRequirement])
  expect(merged).toEqual([otherRequirement, documentRequirement])
  expect(mergeAttachmentAccessRequirements(merged, [documentRequirement])).toEqual(merged)
})

it('rejects malformed durable data rather than replacing it with the active declaration', () => {
  expect(() => mergeAttachmentAccessRequirements({ resolverId: 'broken' }, [documentRequirement])).toThrow()
})

it('rechecks a locked row, retaining a policy concurrently added after discovery without flushing caller state', async () => {
  const discovered = { id: 'partition-1', code: 'privateAttachments', accessResolverRequirements: null }
  const locked = { ...discovered, accessResolverRequirements: [otherRequirement] }
  const transaction = { flush: jest.fn(async () => undefined) }
  const isolated = { transactional: jest.fn(async (callback: (em: typeof transaction) => Promise<number>) => callback(transaction)) }
  const caller = { fork: jest.fn(() => isolated), flush: jest.fn() }
  jest.mocked(findWithDecryption).mockResolvedValue([discovered] as never)
  jest.mocked(findOneWithDecryption).mockResolvedValue(locked as never)
  expect(await syncAttachmentAccessProtection(caller as unknown as EntityManager)).toBe(1)
  expect(caller.fork).toHaveBeenCalledWith({ clear: true, useContext: false })
  expect(locked.accessResolverRequirements).toEqual([otherRequirement, documentRequirement])
  expect(findOneWithDecryption).toHaveBeenCalledWith(transaction, expect.anything(), { id: 'partition-1' }, {
    lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true,
  }, { tenantId: null, organizationId: null })
  expect(transaction.flush).toHaveBeenCalledTimes(1)
  expect(caller.flush).not.toHaveBeenCalled()
})

it('does not mistake duplicate old requirements for coverage of a newly added rule', async () => {
  const partition = { id: 'partition-1', code: 'privateAttachments', accessResolverRequirements: [otherRequirement, otherRequirement] }
  const transaction = { flush: jest.fn(async () => undefined) }
  const isolated = { transactional: jest.fn(async (callback: (em: typeof transaction) => Promise<number>) => callback(transaction)) }
  jest.mocked(findWithDecryption).mockResolvedValue([partition] as never)
  jest.mocked(findOneWithDecryption).mockResolvedValue(partition as never)
  expect(await syncAttachmentAccessProtection({ fork: () => isolated } as unknown as EntityManager)).toBe(1)
  expect(partition.accessResolverRequirements).toEqual([otherRequirement, documentRequirement])
})

it('never removes requirements when the owning module is disabled', async () => {
  registerAttachmentAccessResolvers([])
  const em = { fork: jest.fn(), flush: jest.fn() }
  expect(await syncAttachmentAccessProtection(em as unknown as EntityManager)).toBe(0)
  expect(em.fork).not.toHaveBeenCalled()
  expect(em.flush).not.toHaveBeenCalled()
})

it('rejects a protected partition invisible outside an uncommitted caller transaction', async () => {
  jest.mocked(findWithDecryption).mockResolvedValue([])
  const em = { fork: jest.fn(() => ({})) }
  await expect(ensureAttachmentPartitionProtection(em as unknown as EntityManager, {
    code: 'new-private', accessResolverRequirements: null,
  } as AttachmentPartition)).rejects.toThrow('not durably configured')
})

it('accepts an uncommitted partition carrying every required marker for its atomic commit', async () => {
  const em = { fork: jest.fn() }
  await ensureAttachmentPartitionProtection(em as unknown as EntityManager, {
    code: 'new-private', accessResolverRequirements: [documentRequirement],
  } as AttachmentPartition)
  expect(em.fork).not.toHaveBeenCalled()
})

describe('library exclusion (listInLibrary: false)', () => {
  const inboxRequirement = { resolverId: 'inbox_ops.email-attachments', targetEntity: 'inbox_ops:inbox_email' }

  function registerInbox() {
    registerAttachmentAccessResolvers([
      { moduleId: 'documents', resolvers: [], protectedTargets: [{ ...documentRequirement, targetPartition: '*' }] },
      { moduleId: 'inbox_ops', resolvers: [], protectedTargets: [{ ...inboxRequirement, targetPartition: '*', listInLibrary: false }] },
    ])
  }

  function transactionHarness(partition: Record<string, unknown>) {
    const transaction = { flush: jest.fn(async () => undefined) }
    const isolated = { transactional: jest.fn(async (callback: (em: typeof transaction) => Promise<number>) => callback(transaction)) }
    jest.mocked(findWithDecryption).mockResolvedValue([partition] as never)
    jest.mocked(findOneWithDecryption).mockResolvedValue(partition as never)
    return { em: { fork: jest.fn(() => isolated) } as unknown as EntityManager, transaction, isolated }
  }

  it('keeps the stored requirement rows in their existing two-field shape', () => {
    registerInbox()
    expect(getDeclaredAttachmentAccessRequirements('privateAttachments')).toEqual([documentRequirement, inboxRequirement])
    for (const requirement of getDeclaredAttachmentAccessRequirements('privateAttachments')) {
      expect(Object.keys(requirement).sort()).toEqual(['resolverId', 'targetEntity'])
    }
    expect(getDeclaredLibraryExcludedEntities('privateAttachments')).toEqual(['inbox_ops:inbox_email'])
    expect(getInitialLibraryExcludedEntities('privateAttachments')).toEqual(['inbox_ops:inbox_email'])
  })

  it('returns null for a new partition without declared exclusions', () => {
    expect(getInitialLibraryExcludedEntities('privateAttachments')).toBeNull()
  })

  it('fills the column on a partition whose requirements were already merged', async () => {
    registerInbox()
    const partition = {
      id: 'partition-1', code: 'privateAttachments',
      accessResolverRequirements: [documentRequirement, inboxRequirement], libraryExcludedEntities: null,
    }
    const { em, transaction } = transactionHarness(partition)
    expect(await syncAttachmentAccessProtection(em)).toBe(1)
    expect(partition.accessResolverRequirements).toEqual([documentRequirement, inboxRequirement])
    expect(partition.libraryExcludedEntities).toEqual(['inbox_ops:inbox_email'])
    expect(transaction.flush).toHaveBeenCalledTimes(1)
  })

  it('writes requirements and exclusions together and is idempotent once both are present', async () => {
    registerInbox()
    const partition = { id: 'partition-1', code: 'privateAttachments', accessResolverRequirements: null, libraryExcludedEntities: null }
    const { em } = transactionHarness(partition)
    expect(await syncAttachmentAccessProtection(em)).toBe(1)
    expect(partition.accessResolverRequirements).toEqual([documentRequirement, inboxRequirement])
    expect(partition.libraryExcludedEntities).toEqual(['inbox_ops:inbox_email'])
    expect(await syncAttachmentAccessProtection(em)).toBe(0)
  })

  it('keeps persisted exclusions when the owner module is no longer registered', async () => {
    registerAttachmentAccessResolvers([{ moduleId: 'documents', resolvers: [], protectedTargets: [{ ...documentRequirement, targetPartition: '*' }] }])
    const partition = {
      id: 'partition-1', code: 'privateAttachments',
      accessResolverRequirements: [inboxRequirement], libraryExcludedEntities: ['inbox_ops:inbox_email'],
    }
    const { em } = transactionHarness(partition)
    expect(await syncAttachmentAccessProtection(em)).toBe(1)
    expect(partition.accessResolverRequirements).toEqual([inboxRequirement, documentRequirement])
    expect(partition.libraryExcludedEntities).toEqual(['inbox_ops:inbox_email'])
  })

  it('merges exclusions as a union that never removes entries and rejects malformed durable data', () => {
    expect(mergeLibraryExcludedEntities(['legacy:owner'], ['inbox_ops:inbox_email'])).toEqual(['legacy:owner', 'inbox_ops:inbox_email'])
    expect(mergeLibraryExcludedEntities(['inbox_ops:inbox_email'], [])).toEqual(['inbox_ops:inbox_email'])
    expect(mergeLibraryExcludedEntities(null, ['inbox_ops:inbox_email'])).toEqual(['inbox_ops:inbox_email'])
    expect(() => mergeLibraryExcludedEntities({ entity: 'x' }, ['inbox_ops:inbox_email'])).toThrow()
    expect(() => mergeLibraryExcludedEntities(['*'], [])).toThrow()
  })

  it('syncs on upload when only the exclusion is missing from an otherwise protected partition', async () => {
    registerInbox()
    const partition = {
      id: 'partition-1', code: 'privateAttachments',
      accessResolverRequirements: [documentRequirement, inboxRequirement], libraryExcludedEntities: null,
    }
    const { em, isolated } = transactionHarness(partition)
    await ensureAttachmentPartitionProtection(em, partition as unknown as AttachmentPartition)
    expect(isolated.transactional).toHaveBeenCalledTimes(1)
    expect(partition.libraryExcludedEntities).toEqual(['inbox_ops:inbox_email'])
  })

  it('skips the upload sync when requirements and exclusions are both present', async () => {
    registerInbox()
    const em = { fork: jest.fn() }
    await ensureAttachmentPartitionProtection(em as unknown as EntityManager, {
      code: 'privateAttachments',
      accessResolverRequirements: [documentRequirement, inboxRequirement],
      libraryExcludedEntities: ['inbox_ops:inbox_email'],
    } as AttachmentPartition)
    expect(em.fork).not.toHaveBeenCalled()
  })

  it('resolves library exclusions from the registry and from partitions, after the owner module is disabled too', () => {
    registerInbox()
    expect(resolveLibraryExcludedEntities([])).toEqual(['inbox_ops:inbox_email'])
    registerAttachmentAccessResolvers([])
    expect(resolveLibraryExcludedEntities([{ libraryExcludedEntities: null }])).toEqual([])
    expect(resolveLibraryExcludedEntities([
      { libraryExcludedEntities: ['inbox_ops:inbox_email'] },
      { libraryExcludedEntities: ['inbox_ops:inbox_email', 'legacy:owner', '*', ''] as string[] },
    ])).toEqual(['inbox_ops:inbox_email', 'legacy:owner'])
  })
})
