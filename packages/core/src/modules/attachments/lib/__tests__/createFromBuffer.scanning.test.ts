/** @jest-environment node */
import { createHash } from 'node:crypto'
const mockStore = jest.fn(async () => ({ storagePath: 'stored/file.txt' }))
const mockResolveForPartition = jest.fn(async () => ({ store: mockStore }))

jest.mock('../drivers', () => ({
  StorageDriverFactory: jest.fn(() => ({ resolveForPartition: mockResolveForPartition })),
}))

jest.mock('../../data/entities', () => ({
  Attachment: class Attachment {},
  AttachmentPartition: class AttachmentPartition {},
}))

jest.mock('#generated/entities.ids.generated', () => ({
  E: { attachments: { attachment: 'attachments:attachment' } },
}))

import { createAttachmentFromBuffer } from '../createFromBuffer'
import { AttachmentScanError, type AttachmentScanReceipt } from '../scanning'

function buildEntityManager() {
  const flush = jest.fn(async () => undefined)
  const persist = jest.fn(() => ({ flush }))
  const entityManager = {
    findOne: jest.fn(async () => ({ code: 'privateAttachments', storageDriver: 'local' })),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => ({ ...payload })),
    transactional: jest.fn(async (work: (transaction: { persist: typeof persist }) => Promise<void>) => {
      await work({ persist })
    }),
  }
  return { entityManager, flush, persist }
}

function cleanReceipt(): AttachmentScanReceipt {
  return {
    status: 'clean',
    scanner: 'test-scanner',
    policy: 'required',
    checkedAt: '2026-08-21T12:00:00.000Z',
    contentSha256: createHash('sha256').update(Buffer.from('clean')).digest('hex'),
    reasonCode: null,
  }
}

describe('createAttachmentFromBuffer scanning', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('scans before normal storage and persists the receipt', async () => {
    const { entityManager } = buildEntityManager()
    const scan = jest.fn(async () => cleanReceipt())

    await createAttachmentFromBuffer({
      em: entityManager as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityId: 'example:todo',
      recordId: 'record-1',
      fileName: 'result.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('clean'),
      attachmentScanGate: { scan },
    })

    expect(scan).toHaveBeenCalledTimes(1)
    expect(scan.mock.invocationCallOrder[0]).toBeLessThan(mockStore.mock.invocationCallOrder[0])
    expect(entityManager.create).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      storageMetadata: expect.objectContaining({
        securityScan: expect.objectContaining({ status: 'clean', scanner: 'test-scanner' }),
      }),
    }))
  })

  it('does not resolve storage or create a row for an EICAR verdict', async () => {
    const { entityManager } = buildEntityManager()
    const receipt: AttachmentScanReceipt = {
      ...cleanReceipt(),
      status: 'quarantined',
      reasonCode: 'malware_detected',
    }
    const scan = jest.fn(async () => {
      throw new AttachmentScanError('quarantined', receipt, 'quarantine-1')
    })

    await expect(createAttachmentFromBuffer({
      em: entityManager as never,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      entityId: 'example:todo',
      recordId: 'record-1',
      fileName: 'eicar.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'),
      attachmentScanGate: { scan },
    })).rejects.toMatchObject({ code: 'quarantined' })

    expect(mockResolveForPartition).not.toHaveBeenCalled()
    expect(mockStore).not.toHaveBeenCalled()
    expect(entityManager.create).not.toHaveBeenCalled()
  })
})
