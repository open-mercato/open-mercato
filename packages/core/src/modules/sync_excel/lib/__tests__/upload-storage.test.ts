import { promises as fs } from 'fs'
import { readSyncExcelUploadBuffer } from '../upload-storage'

describe('sync_excel upload storage', () => {
  const mockReadFile = jest.spyOn(fs, 'readFile')

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('reads CSV payload from attachment metadata when an inline copy is persisted for worker-safe imports', async () => {
    const buffer = await readSyncExcelUploadBuffer({
      partitionCode: 'privateAttachments',
      storagePath: 'org-1/tenant-1/import.csv',
      storageDriver: 'local',
      storageMetadata: {
        inlineCsvBase64: Buffer.from('Record Id,Email\next-1,ada@example.com\n', 'utf8').toString('base64'),
      },
    })

    expect(buffer.toString('utf8')).toBe('Record Id,Email\next-1,ada@example.com\n')
    expect(mockReadFile).not.toHaveBeenCalled()
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

})
