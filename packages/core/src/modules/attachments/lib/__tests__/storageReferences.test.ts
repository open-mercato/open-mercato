import type { EntityManager } from '@mikro-orm/postgresql'
import type { Attachment } from '../../data/entities'
import {
  listAttachmentStorageReferences,
  removeAttachmentRecord,
  resolveAttachmentStorageRelease,
} from '../storageReferences'

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
  })
})
