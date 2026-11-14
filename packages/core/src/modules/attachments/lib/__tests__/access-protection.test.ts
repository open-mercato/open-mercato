import type { EntityManager } from '@mikro-orm/postgresql'
import type { AttachmentPartition } from '../../data/entities'
import { LockMode } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { ensureAttachmentPartitionProtection, mergeAttachmentAccessRequirements, syncAttachmentAccessProtection } from '../access-protection'
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
