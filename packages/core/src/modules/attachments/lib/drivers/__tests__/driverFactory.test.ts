/** @jest-environment node */

// Mock fs so LocalStorageDriver / LegacyPublicStorageDriver don't touch disk
jest.mock('fs', () => ({ promises: { mkdir: jest.fn(), writeFile: jest.fn(), readFile: jest.fn(), unlink: jest.fn() } }))
jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  resolvePartitionRoot: jest.fn(() => '/storage/test'),
}))

// Minimal em mock — resolveForPartition uses em.findOne
const mockFindOne = jest.fn()
const mockEm = { findOne: mockFindOne } as unknown as import('@mikro-orm/postgresql').EntityManager

import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers/driverFactory'
import { LocalStorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers/localDriver'
import { LegacyPublicStorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers/legacyPublicDriver'
import type { StorageDriver, StoreFilePayload, StoredFile, ReadFileResult } from '@open-mercato/core/modules/attachments/lib/drivers/types'

class FakeExternalDriver implements StorageDriver {
  readonly key = 'fake'
  readonly config: Record<string, unknown>
  constructor(config: Record<string, unknown>) { this.config = config }
  store(_p: StoreFilePayload): Promise<StoredFile> { return Promise.resolve({ storagePath: 'fake/path' }) }
  read(_pc: string, _sp: string): Promise<ReadFileResult> { return Promise.resolve({ buffer: Buffer.from('') }) }
  delete(_pc: string, _sp: string): Promise<void> { return Promise.resolve() }
  toLocalPath(_pc: string, _sp: string): Promise<{ filePath: string; cleanup: () => Promise<void> }> {
    return Promise.resolve({ filePath: '/tmp/fake', cleanup: async () => {} })
  }
}

describe('StorageDriverFactory', () => {
  let factory: StorageDriverFactory

  beforeEach(() => {
    jest.clearAllMocks()
    factory = new StorageDriverFactory(mockEm)
  })

  describe('resolveForAttachment()', () => {
    it("returns LocalStorageDriver for 'local'", () => {
      const driver = factory.resolveForAttachment('local')
      expect(driver).toBeInstanceOf(LocalStorageDriver)
    })

    it("returns LegacyPublicStorageDriver for 'legacyPublic'", () => {
      const driver = factory.resolveForAttachment('legacyPublic')
      expect(driver).toBeInstanceOf(LegacyPublicStorageDriver)
    })

    it('falls back to LocalStorageDriver for an unregistered driver key', () => {
      const driver = factory.resolveForAttachment('unknown-driver')
      expect(driver).toBeInstanceOf(LocalStorageDriver)
    })

    it('returns an externally-registered driver when its key matches', () => {
      factory.registerDriver('fake', (config) => new FakeExternalDriver(config))
      const driver = factory.resolveForAttachment('fake', { bucket: 'my-bucket' })
      expect(driver).toBeInstanceOf(FakeExternalDriver)
    })

    it('passes configJson to the external factory', () => {
      const spyFactory = jest.fn((config: Record<string, unknown>) => new FakeExternalDriver(config))
      factory.registerDriver('fake', spyFactory)
      factory.resolveForAttachment('fake', { bucket: 'b1', region: 'eu-west-1' })
      expect(spyFactory).toHaveBeenCalledWith({ bucket: 'b1', region: 'eu-west-1' })
    })

    it('caches the driver when called twice with the same configJson', () => {
      const spyFactory = jest.fn((config: Record<string, unknown>) => new FakeExternalDriver(config))
      factory.registerDriver('fake', spyFactory)

      const config = { bucket: 'same-bucket' }
      const d1 = factory.resolveForAttachment('fake', config)
      const d2 = factory.resolveForAttachment('fake', config)

      expect(d1).toBe(d2)
      expect(spyFactory).toHaveBeenCalledTimes(1)
    })

    it('creates a new driver instance when configJson differs', () => {
      const spyFactory = jest.fn((config: Record<string, unknown>) => new FakeExternalDriver(config))
      factory.registerDriver('fake', spyFactory)

      const d1 = factory.resolveForAttachment('fake', { bucket: 'bucket-a' })
      const d2 = factory.resolveForAttachment('fake', { bucket: 'bucket-b' })

      expect(d1).not.toBe(d2)
      expect(spyFactory).toHaveBeenCalledTimes(2)
    })
  })

  describe('resolveForPartition()', () => {
    it('returns LocalStorageDriver when partition is not found', async () => {
      mockFindOne.mockResolvedValueOnce(null)
      const driver = await factory.resolveForPartition('non-existent')
      expect(driver).toBeInstanceOf(LocalStorageDriver)
    })

    it('dispatches to the correct driver based on partition.storageDriver', async () => {
      mockFindOne.mockResolvedValueOnce({ storageDriver: 'local', configJson: null })
      const driver = await factory.resolveForPartition('main')
      expect(driver).toBeInstanceOf(LocalStorageDriver)
    })

    it('dispatches to an externally-registered driver found via partition', async () => {
      factory.registerDriver('fake', (config) => new FakeExternalDriver(config))
      mockFindOne.mockResolvedValueOnce({ storageDriver: 'fake', configJson: { bucket: 'p-bucket' } })
      const driver = await factory.resolveForPartition('s3-partition')
      expect(driver).toBeInstanceOf(FakeExternalDriver)
    })
  })
})
