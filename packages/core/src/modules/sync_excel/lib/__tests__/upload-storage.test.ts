import { promises as fs } from 'fs'
import { createSyncExcelUploadReadStream, readSyncExcelUploadBuffer } from '../upload-storage'

async function readStreamText(stream: NodeJS.ReadableStream): Promise<string> {
  let text = ''
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    text += chunk.toString()
  }
  return text
}

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

  it('streams CSV payload from attachment metadata when storage path resolution fails', async () => {
    const stream = await createSyncExcelUploadReadStream({
      partitionCode: 'privateAttachments',
      storagePath: '../outside/import.csv',
      storageDriver: 'local',
      storageMetadata: {
        inlineCsvBase64: Buffer.from('Record Id,Email\next-1,ada@example.com\n', 'utf8').toString('base64'),
      },
    })

    await expect(readStreamText(stream)).resolves.toBe('Record Id,Email\next-1,ada@example.com\n')
  })

})
