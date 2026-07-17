import { promises as fs } from 'fs'
import {
  createSyncExcelUploadAttachment,
  createSyncExcelUploadReadStream,
  readSyncExcelUploadBuffer,
} from '../upload-storage'

async function readStreamText(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    text += chunk.toString()
  }
  return text
}

const mockStorePartitionFile = jest.fn()
const mockBuildAttachmentFileUrl = jest.fn()

jest.mock('../../../attachments/lib/partitions', () => ({
  ensureDefaultPartitions: jest.fn(),
}))

jest.mock('../../../attachments/lib/storage', () => ({
  resolveAttachmentAbsolutePath: jest.fn((_partitionCode: string, storagePath: string) => `/tmp/${storagePath}`),
  storePartitionFile: (...args: unknown[]) => mockStorePartitionFile(...args),
}))

jest.mock('../../../attachments/lib/imageUrls', () => ({
  buildAttachmentFileUrl: (...args: unknown[]) => mockBuildAttachmentFileUrl(...args),
}))

describe('sync_excel upload storage', () => {
  const mockReadFile = jest.spyOn(fs, 'readFile')
  const mockAccess = jest.spyOn(fs, 'access')

  beforeEach(() => {
    jest.clearAllMocks()
    mockReadFile.mockReset()
    mockAccess.mockReset()
    mockBuildAttachmentFileUrl.mockImplementation((attachmentId: string) => `/api/attachments/file/${attachmentId}`)
    mockStorePartitionFile.mockResolvedValue({
      storagePath: 'org-1/tenant-1/import.csv',
      absolutePath: '/tmp/import.csv',
      fileName: 'import.csv',
    })
  })

  it('does not persist an inline base64 copy for new uploads', async () => {
    const csvBuffer = Buffer.from('Record Id,Email\next-1,ada@example.com\n', 'utf8')
    const mockEm = {
      findOne: jest.fn(async () => ({
        code: 'privateAttachments',
        storageDriver: 'local',
      })),
      create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => payload),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }

    const attachment = await createSyncExcelUploadAttachment({
      em: mockEm as any,
      uploadId: 'upload-1',
      organizationId: 'org-1',
      tenantId: 'tenant-1',
      fileName: 'leads.csv',
      mimeType: 'text/csv',
      buffer: csvBuffer,
    })

    expect(mockStorePartitionFile).toHaveBeenCalledWith(expect.objectContaining({
      partitionCode: 'privateAttachments',
      orgId: 'org-1',
      tenantId: 'tenant-1',
      fileName: 'leads.csv',
      buffer: csvBuffer,
    }))
    expect(attachment.storageMetadata).toEqual({
      module: 'sync_excel',
      temporary: true,
      uploadId: 'upload-1',
    })
    expect(attachment.storageMetadata).not.toHaveProperty('inlineCsvBase64')
    expect(mockEm.persist).toHaveBeenCalledWith(attachment)
    expect(mockEm.flush).toHaveBeenCalledTimes(1)
  })

  it('prefers attachment storage over legacy inline metadata when both are present', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('Record Id,Email\next-2,grace@example.com\n', 'utf8'))

    const buffer = await readSyncExcelUploadBuffer({
      partitionCode: 'privateAttachments',
      storagePath: 'org-1/tenant-1/import.csv',
      storageDriver: 'local',
      storageMetadata: {
        inlineCsvBase64: Buffer.from('Record Id,Email\next-1,ada@example.com\n', 'utf8').toString('base64'),
      },
    })

    expect(buffer.toString('utf8')).toBe('Record Id,Email\next-2,grace@example.com\n')
    expect(mockReadFile).toHaveBeenCalledTimes(1)
  })

  it('falls back to attachment storage for older uploads without persisted file content', async () => {
    mockReadFile.mockResolvedValue(Buffer.from('legacy csv', 'utf8'))

    const buffer = await readSyncExcelUploadBuffer(
      {
        partitionCode: 'privateAttachments',
        storagePath: 'org-1/tenant-1/legacy.csv',
        storageDriver: 'local',
        storageMetadata: null,
      },
    )

    expect(buffer.toString('utf8')).toBe('legacy csv')
    expect(mockReadFile).toHaveBeenCalledTimes(1)
  })

  it('falls back to legacy inline metadata when the stored file is unavailable', async () => {
    mockReadFile.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    const buffer = await readSyncExcelUploadBuffer({
      partitionCode: 'privateAttachments',
      storagePath: 'org-1/tenant-1/missing.csv',
      storageDriver: 'local',
      storageMetadata: {
        inlineCsvBase64: Buffer.from('legacy csv', 'utf8').toString('base64'),
      },
    })

    expect(buffer.toString('utf8')).toBe('legacy csv')
    expect(mockReadFile).toHaveBeenCalledTimes(1)
  })

  it('streams legacy inline metadata when the stored file is unavailable', async () => {
    mockAccess.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))

    const stream = await createSyncExcelUploadReadStream({
      partitionCode: 'privateAttachments',
      storagePath: 'org-1/tenant-1/missing.csv',
      storageDriver: 'local',
      storageMetadata: {
        inlineCsvBase64: Buffer.from('Record Id,Email\next-1,ada@example.com\n', 'utf8').toString('base64'),
      },
    })

    await expect(readStreamText(stream)).resolves.toBe('Record Id,Email\next-1,ada@example.com\n')
    expect(mockAccess).toHaveBeenCalledTimes(1)
  })

})
