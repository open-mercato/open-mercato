/** @jest-environment node */
import path from 'path'

const mockReadFile = jest.fn().mockResolvedValue(Buffer.from('legacy-content'))
const mockUnlink = jest.fn().mockResolvedValue(undefined)

jest.mock('fs', () => ({
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}))

import { LegacyPublicStorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers/legacyPublicDriver'

describe('LegacyPublicStorageDriver', () => {
  let driver: LegacyPublicStorageDriver

  beforeEach(() => {
    jest.clearAllMocks()
    driver = new LegacyPublicStorageDriver()
  })

  describe('store()', () => {
    it('throws with a read-only error', () => {
      expect(() =>
        driver.store({
          partitionCode: 'pub',
          orgId: 'org-a',
          tenantId: 'tenant-b',
          fileName: 'doc.pdf',
          buffer: Buffer.from('x'),
        }),
      ).toThrow('legacy-public driver is read-only')
    })
  })

  describe('read()', () => {
    it('reads relative to process.cwd()', async () => {
      await driver.read('', 'public/uploads/image.png')

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join(process.cwd(), 'public/uploads/image.png'),
      )
    })

    it('strips leading slashes from storagePath', async () => {
      await driver.read('', '/public/img.png')

      expect(mockReadFile).toHaveBeenCalledWith(path.join(process.cwd(), 'public/img.png'))
    })

    it('removes path traversal segments', async () => {
      await driver.read('', '../../etc/passwd')

      const calledPath = String(mockReadFile.mock.calls[0][0])
      expect(calledPath).not.toContain('..')
      expect(calledPath).toContain(process.cwd())
    })
  })

  describe('delete()', () => {
    it('unlinks relative to process.cwd()', async () => {
      await driver.delete('', 'public/uploads/file.txt')

      expect(mockUnlink).toHaveBeenCalledWith(
        path.join(process.cwd(), 'public/uploads/file.txt'),
      )
    })

    it('does not throw on ENOENT (best-effort)', async () => {
      mockUnlink.mockRejectedValueOnce(new Error('ENOENT'))
      await expect(driver.delete('', 'missing.txt')).resolves.not.toThrow()
    })
  })

  describe('toLocalPath()', () => {
    it('returns absolute path relative to cwd and a no-op cleanup', async () => {
      const { filePath, cleanup } = await driver.toLocalPath('', 'public/uploads/img.png')

      expect(filePath).toBe(path.join(process.cwd(), 'public/uploads/img.png'))
      await expect(cleanup()).resolves.not.toThrow()
    })
  })
})
