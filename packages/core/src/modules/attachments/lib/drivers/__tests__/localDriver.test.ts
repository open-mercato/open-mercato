/** @jest-environment node */
import path from 'path'

const mockMkdir = jest.fn().mockResolvedValue(undefined)
const mockWriteFile = jest.fn().mockResolvedValue(undefined)
const mockReadFile = jest.fn().mockResolvedValue(Buffer.from('hello'))
const mockUnlink = jest.fn().mockResolvedValue(undefined)

jest.mock('fs', () => ({
  promises: {
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}))

const mockResolvePartitionRoot = jest.fn((code: string) => `/storage/${code}`)

jest.mock('@open-mercato/core/modules/attachments/lib/storage', () => ({
  resolvePartitionRoot: (code: string) => mockResolvePartitionRoot(code),
}))

import { LocalStorageDriver } from '@open-mercato/core/modules/attachments/lib/drivers/localDriver'

const PARTITION = 'main'
const ORG = 'org-abc'
const TENANT = 'tenant-xyz'

describe('LocalStorageDriver', () => {
  let driver: LocalStorageDriver

  beforeEach(() => {
    jest.clearAllMocks()
    driver = new LocalStorageDriver()
  })

  describe('store()', () => {
    it('writes the file and returns a scoped storagePath', async () => {
      const result = await driver.store({
        partitionCode: PARTITION,
        orgId: ORG,
        tenantId: TENANT,
        fileName: 'report.pdf',
        buffer: Buffer.from('data'),
      })

      expect(mockMkdir).toHaveBeenCalledTimes(1)
      expect(mockWriteFile).toHaveBeenCalledTimes(1)

      // Path must be under org/tenant segments
      expect(result.storagePath).toMatch(/^org_org-abc\/tenant_tenant-xyz\//)
      expect(result.storagePath).toContain('report.pdf')
    })

    it('uses org_shared / tenant_shared when orgId / tenantId are absent', async () => {
      const result = await driver.store({
        partitionCode: PARTITION,
        orgId: null,
        tenantId: undefined,
        fileName: 'file.txt',
        buffer: Buffer.from('x'),
      })

      expect(result.storagePath).toMatch(/^org_shared\/tenant_shared\//)
    })

    it('sanitizes dangerous characters in the file name', async () => {
      const result = await driver.store({
        partitionCode: PARTITION,
        orgId: ORG,
        tenantId: TENANT,
        fileName: 'bad name;rm -rf *.pdf',
        buffer: Buffer.from('x'),
      })

      expect(result.storagePath).not.toMatch(/[\s;]/)
    })

    it('uses partition root resolved by resolvePartitionRoot', async () => {
      await driver.store({
        partitionCode: 'docs',
        orgId: ORG,
        tenantId: TENANT,
        fileName: 'x.txt',
        buffer: Buffer.from('x'),
      })

      expect(mockResolvePartitionRoot).toHaveBeenCalledWith('docs')
      const [[dirArg]] = mockMkdir.mock.calls
      expect(String(dirArg)).toContain('/storage/docs')
    })
  })

  describe('read()', () => {
    it('reads from the resolved absolute path', async () => {
      const result = await driver.read(PARTITION, 'org_org-abc/tenant_tenant-xyz/file.txt')

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/storage/main', 'org_org-abc/tenant_tenant-xyz/file.txt'),
      )
      expect(result.buffer).toEqual(Buffer.from('hello'))
    })
  })

  describe('delete()', () => {
    it('unlinks the resolved path', async () => {
      await driver.delete(PARTITION, 'org_org-abc/tenant_tenant-xyz/file.txt')

      expect(mockUnlink).toHaveBeenCalledWith(
        path.join('/storage/main', 'org_org-abc/tenant_tenant-xyz/file.txt'),
      )
    })

    it('does not throw when unlink fails (best-effort removal)', async () => {
      mockUnlink.mockRejectedValueOnce(new Error('ENOENT'))
      await expect(driver.delete(PARTITION, 'org_a/tenant_b/missing.txt')).resolves.not.toThrow()
    })
  })

  describe('toLocalPath()', () => {
    it('returns the resolved absolute path and a no-op cleanup', async () => {
      const { filePath, cleanup } = await driver.toLocalPath(
        PARTITION,
        'org_org-abc/tenant_tenant-xyz/file.txt',
      )

      expect(filePath).toBe(
        path.join('/storage/main', 'org_org-abc/tenant_tenant-xyz/file.txt'),
      )
      await expect(cleanup()).resolves.not.toThrow()
      // cleanup must NOT delete the original file
      expect(mockUnlink).not.toHaveBeenCalled()
    })
  })

  describe('resolveAbsolutePath() — path traversal sanitization', () => {
    it('strips leading slashes from storagePath', async () => {
      await driver.read(PARTITION, '///org_a/tenant_b/file.txt')

      expect(mockReadFile).toHaveBeenCalledWith(
        path.join('/storage/main', 'org_a/tenant_b/file.txt'),
      )
    })

    it('removes ../ traversal segments', async () => {
      await driver.read(PARTITION, '../../etc/passwd')

      const calledPath = String(mockReadFile.mock.calls[0][0])
      expect(calledPath).not.toContain('..')
      expect(calledPath).toContain('/storage/main')
    })

    it('removes nested ../ traversal', async () => {
      await driver.read(PARTITION, 'org_a/../../etc/passwd')

      const calledPath = String(mockReadFile.mock.calls[0][0])
      expect(calledPath).not.toContain('..')
    })
  })
})
