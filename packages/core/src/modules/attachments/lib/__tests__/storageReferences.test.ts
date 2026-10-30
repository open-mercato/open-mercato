import type { EntityManager } from '@mikro-orm/postgresql'
import type { Attachment } from '../../data/entities'
import { purgeDocumentStructure } from '../documentStructure/purge'
import {
  listAttachmentStorageReferences,
  removeAttachmentRecord,
  resolveAttachmentStorageRelease,
} from '../storageReferences'

jest.mock('../documentStructure/purge', () => ({
  purgeDocumentStructure: jest.fn(async () => ({ extractionCount: 1, sectionCount: 3 })),
}))

const purgeMock = jest.mocked(purgeDocumentStructure)

beforeEach(() => {
  purgeMock.mockClear()
})

function createEntityManager(lockedIds: string[], options: { inTransaction?: boolean } = {}) {
  let inTransaction = options.inTransaction ?? false
  const query = {
    select: jest.fn(() => query),
    where: jest.fn(() => query),
    orderBy: jest.fn(() => query),
    forUpdate: jest.fn(() => query),
    execute: jest.fn(async () => lockedIds.map((id) => ({ id }))),
  }
  const em = {
    getKysely: jest.fn(() => ({ selectFrom: jest.fn(() => query) })),
    remove: jest.fn(),
    flush: jest.fn(async () => undefined),
    begin: jest.fn(async () => { inTransaction = true }),
    commit: jest.fn(async () => { inTransaction = false }),
    rollback: jest.fn(async () => { inTransaction = false }),
    isInTransaction: jest.fn(() => inTransaction),
  }
  return { em, query }
}

const attachment = {
  id: 'attachment-1',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  partitionCode: 'productsMedia',
  storagePath: 'org/tenant/shared.png',
} as Attachment

describe('resolveAttachmentStorageRelease', () => {
  it('releases storage only when the removed row was the last reference', () => {
    expect(resolveAttachmentStorageRelease(['attachment-1'], 'attachment-1')).toEqual({ removed: true, releaseStorage: true })
    expect(resolveAttachmentStorageRelease(['attachment-0', 'attachment-1'], 'attachment-1')).toEqual({ removed: true, releaseStorage: false })
    expect(resolveAttachmentStorageRelease(['attachment-0'], 'attachment-1')).toEqual({ removed: false, releaseStorage: false })
  })
})

describe('listAttachmentStorageReferences', () => {
  it('reads the rows sharing the stored object without locking them', async () => {
    const { em, query } = createEntityManager(['attachment-1', 'attachment-copy'])

    const ids = await listAttachmentStorageReferences(em as unknown as EntityManager, attachment)

    expect(ids).toEqual(['attachment-1', 'attachment-copy'])
    expect(query.where).toHaveBeenCalledWith('partition_code', '=', 'productsMedia')
    expect(query.where).toHaveBeenCalledWith('storage_path', '=', 'org/tenant/shared.png')
    expect(query.forUpdate).not.toHaveBeenCalled()
  })
})

describe('removeAttachmentRecord', () => {
  it('locks the rows sharing the stored object and removes the row in its own transaction', async () => {
    const { em, query } = createEntityManager(['attachment-1', 'attachment-copy'])

    const removal = await removeAttachmentRecord(em as unknown as EntityManager, attachment)

    expect(removal).toEqual({ removed: true, releaseStorage: false })
    expect(query.where).toHaveBeenCalledWith('partition_code', '=', 'productsMedia')
    expect(query.where).toHaveBeenCalledWith('storage_path', '=', 'org/tenant/shared.png')
    expect(query.orderBy).toHaveBeenCalledWith('id')
    expect(query.forUpdate).toHaveBeenCalledTimes(1)
    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.remove).toHaveBeenCalledWith(attachment)
    expect(em.commit).toHaveBeenCalledTimes(1)
    expect(query.execute.mock.invocationCallOrder[0]).toBeGreaterThan(em.begin.mock.invocationCallOrder[0])
  })

  it('refuses to join an ambient transaction whose rollback could outlive deleted bytes', async () => {
    const { em, query } = createEntityManager(['attachment-1'], { inTransaction: true })

    await expect(removeAttachmentRecord(em as unknown as EntityManager, attachment)).rejects.toThrow('[internal]')

    expect(query.execute).not.toHaveBeenCalled()
    expect(em.remove).not.toHaveBeenCalled()
  })

  it('leaves the row alone when a concurrent delete already removed it', async () => {
    const { em } = createEntityManager(['attachment-copy'])

    const removal = await removeAttachmentRecord(em as unknown as EntityManager, attachment)

    expect(removal).toEqual({ removed: false, releaseStorage: false })
    expect(em.remove).not.toHaveBeenCalled()
    expect(purgeMock).not.toHaveBeenCalled()
  })

  it('purges the document structure of the removed row inside its transaction for every caller', async () => {
    const { em } = createEntityManager(['attachment-1'])

    const removal = await removeAttachmentRecord(em as unknown as EntityManager, attachment)

    expect(removal).toEqual({ removed: true, releaseStorage: true })
    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(purgeMock).toHaveBeenCalledWith(
      em,
      { attachmentId: 'attachment-1', tenantId: 'tenant-1', organizationId: 'org-1' },
      { flush: false },
    )
    const purgeOrder = purgeMock.mock.invocationCallOrder[0]
    expect(purgeOrder).toBeGreaterThan(em.begin.mock.invocationCallOrder[0])
    expect(purgeOrder).toBeLessThan(em.remove.mock.invocationCallOrder[0])
    expect(purgeOrder).toBeLessThan(em.commit.mock.invocationCallOrder[0])
  })

  it('purges only the removed row while the shared stored object stays for the other reference', async () => {
    const { em } = createEntityManager(['attachment-1', 'attachment-copy'])

    const removal = await removeAttachmentRecord(em as unknown as EntityManager, attachment)

    expect(removal).toEqual({ removed: true, releaseStorage: false })
    expect(purgeMock).toHaveBeenCalledTimes(1)
    expect(purgeMock.mock.calls[0][1]).toEqual(expect.objectContaining({ attachmentId: 'attachment-1' }))
  })

  it('runs caller work after the purge in the same transaction', async () => {
    const { em } = createEntityManager(['attachment-1'])
    const beforeRemove = jest.fn(async () => undefined)

    await removeAttachmentRecord(em as unknown as EntityManager, attachment, { beforeRemove })

    expect(beforeRemove).toHaveBeenCalledTimes(1)
    expect(beforeRemove.mock.invocationCallOrder[0]).toBeGreaterThan(purgeMock.mock.invocationCallOrder[0])
    expect(beforeRemove.mock.invocationCallOrder[0]).toBeLessThan(em.commit.mock.invocationCallOrder[0])
  })

  it('does not purge when the transaction refuses an ambient one', async () => {
    const { em } = createEntityManager(['attachment-1'], { inTransaction: true })

    await expect(removeAttachmentRecord(em as unknown as EntityManager, attachment)).rejects.toThrow('[internal]')

    expect(purgeMock).not.toHaveBeenCalled()
  })
})
