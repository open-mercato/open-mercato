import type { EntityManager } from '@mikro-orm/postgresql'
import { StorageDriverFactory } from '../driverFactory'
import { LocalStorageDriver } from '../localDriver'

jest.mock('../localDriver', () => ({
  LocalStorageDriver: jest.fn(() => ({ key: 'local', store: jest.fn() })),
}))
jest.mock('../legacyPublicDriver', () => ({
  LegacyPublicStorageDriver: jest.fn(() => ({ key: 'legacyPublic' })),
}))

const findOne = jest.fn()
const em = { findOne } as unknown as EntityManager
const previousPolicy = process.env.OM_ATTACHMENT_STORAGE_POLICY

beforeEach(() => {
  jest.clearAllMocks()
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strict'
})

afterEach(() => {
  if (previousPolicy === undefined) delete process.env.OM_ATTACHMENT_STORAGE_POLICY
  else process.env.OM_ATTACHMENT_STORAGE_POLICY = previousPolicy
})

it.each([
  ['missing partition', null, 'partition_missing'],
  ['null driver', { storageDriver: null, configJson: {} }, 'driver_missing'],
  ['unknown driver', { storageDriver: 'missing-provider', configJson: {} }, 'unknown_driver'],
  ['array configuration', { storageDriver: 'local', configJson: [] }, 'invalid_config'],
  ['scalar configuration', { storageDriver: 'local', configJson: 'secret-sentinel' }, 'invalid_config'],
])('rejects %s before local construction', async (_description, partition, reason) => {
  findOne.mockResolvedValue(partition)
  const factory = new StorageDriverFactory(em)
  await expect(factory.resolveForPartition('privateAttachments')).rejects.toMatchObject({
    code: 'ATTACHMENT_STORAGE_CONFIGURATION_INVALID', reason,
  })
  expect(LocalStorageDriver).not.toHaveBeenCalled()
})

it('does not silently select local for a direct unknown driver', () => {
  const factory = new StorageDriverFactory(em)
  expect(() => factory.resolveForAttachment('missing-provider')).toThrow()
  expect(LocalStorageDriver).not.toHaveBeenCalled()
})

it('rejects a misspelled policy before selecting storage', async () => {
  process.env.OM_ATTACHMENT_STORAGE_POLICY = 'strcit'
  findOne.mockResolvedValue({ storageDriver: 'local', configJson: null })
  const factory = new StorageDriverFactory(em)
  await expect(factory.resolveForPartition('privateAttachments')).rejects.toMatchObject({ reason: 'invalid_policy' })
  expect(LocalStorageDriver).not.toHaveBeenCalled()
})
