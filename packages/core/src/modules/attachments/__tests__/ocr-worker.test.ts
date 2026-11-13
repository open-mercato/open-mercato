import type { EntityManager } from '@mikro-orm/postgresql'
import { metadata, runAttachmentOcrJob } from '../workers/ocr'
import { processAttachmentOcr } from '../lib/ocrQueue'
import type { StorageDriverFactory } from '../lib/drivers'

jest.mock('../lib/ocrQueue', () => ({ processAttachmentOcr: jest.fn(async () => undefined) }))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async (em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) =>
    em.findOne(...args),
}))

const ATTACHMENT_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'

function harness(row: Record<string, unknown> | null) {
  const driver = { key: 'local' }
  const em = { findOne: jest.fn(async () => row) } as unknown as EntityManager & { findOne: jest.Mock }
  const storageDriverFactory = {
    resolveForPartition: jest.fn(async () => driver),
  } as unknown as StorageDriverFactory & { resolveForPartition: jest.Mock }
  return { em, storageDriverFactory, driver }
}

describe('attachments OCR worker', () => {
  beforeEach(() => jest.mocked(processAttachmentOcr).mockClear())

  it('declares the attachments-ocr queue with bounded concurrency', () => {
    expect(metadata.queue).toBe('attachments-ocr')
    expect(metadata.id).toBe('attachments:ocr')
    expect(metadata.concurrency).toBeGreaterThanOrEqual(1)
    expect(metadata.concurrency).toBeLessThanOrEqual(20)
  })

  it('re-reads the attachment within the job scope and runs OCR with the stored file', async () => {
    const { em, storageDriverFactory, driver } = harness({
      id: ATTACHMENT_ID,
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      partitionCode: 'privateAttachments',
      storagePath: 'tenant/org/file.pdf',
      mimeType: 'application/pdf',
    })

    await runAttachmentOcrJob(
      { attachmentId: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { em, storageDriverFactory },
    )

    expect(em.findOne).toHaveBeenCalledWith(
      expect.anything(),
      { id: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      undefined,
      { tenantId: TENANT_ID, organizationId: ORG_ID },
    )
    expect(storageDriverFactory.resolveForPartition).toHaveBeenCalledWith('privateAttachments', {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expect(processAttachmentOcr).toHaveBeenCalledWith(
      em,
      {
        attachmentId: ATTACHMENT_ID,
        storagePath: 'tenant/org/file.pdf',
        mimeType: 'application/pdf',
        partitionCode: 'privateAttachments',
        organizationId: ORG_ID,
        tenantId: TENANT_ID,
      },
      driver,
    )
  })

  it('skips an attachment deleted before the job ran so retries stay idempotent', async () => {
    const { em, storageDriverFactory } = harness(null)

    await runAttachmentOcrJob(
      { attachmentId: ATTACHMENT_ID, tenantId: TENANT_ID, organizationId: ORG_ID },
      { em, storageDriverFactory },
    )

    expect(storageDriverFactory.resolveForPartition).not.toHaveBeenCalled()
    expect(processAttachmentOcr).not.toHaveBeenCalled()
  })

  it('discards a malformed payload without touching storage', async () => {
    const { em, storageDriverFactory } = harness(null)

    await runAttachmentOcrJob(
      { attachmentId: 'not-a-uuid', tenantId: TENANT_ID, organizationId: ORG_ID },
      { em, storageDriverFactory },
    )

    expect(em.findOne).not.toHaveBeenCalled()
    expect(processAttachmentOcr).not.toHaveBeenCalled()
  })
})
