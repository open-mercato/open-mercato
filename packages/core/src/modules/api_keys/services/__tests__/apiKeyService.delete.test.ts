jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (
    em: { findOne: (...args: unknown[]) => unknown },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findOne(entity, where, options),
}))

const mockInvalidateByKeyId = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/apiKeyAuthCache', () => ({
  getSharedApiKeyAuthCache: () => ({ invalidateByKeyId: mockInvalidateByKeyId }),
}))

import { deleteApiKey } from '../apiKeyService'

describe('deleteApiKey transaction boundary', () => {
  it('rolls back the locked key mutation and skips cache invalidation when authorization fails', async () => {
    const record = { id: 'key-1', deletedAt: null as Date | null }
    const em = {
      findOne: jest.fn(async () => record),
      persist: jest.fn(() => em),
      flush: jest.fn(async () => undefined),
      begin: jest.fn(async () => undefined),
      commit: jest.fn(async () => undefined),
      rollback: jest.fn(async () => {
        record.deletedAt = null
      }),
      isInTransaction: jest.fn(() => false),
      getUnitOfWork: jest.fn(() => ({ getChangeSets: () => [] })),
    }

    await expect(deleteApiKey(em as never, record.id, {
      authorize: () => {
        throw new Error('denied under lock')
      },
    })).rejects.toThrow('denied under lock')

    expect(em.begin).toHaveBeenCalledTimes(1)
    expect(em.rollback).toHaveBeenCalledTimes(1)
    expect(em.commit).not.toHaveBeenCalled()
    expect(record.deletedAt).toBeNull()
    expect(mockInvalidateByKeyId).not.toHaveBeenCalled()
  })
})
