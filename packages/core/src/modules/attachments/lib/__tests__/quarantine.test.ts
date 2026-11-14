/** @jest-environment node */
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { LocalAttachmentQuarantineStore } from '../quarantine'
import type { AttachmentScanReceipt } from '../scanning'

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('LocalAttachmentQuarantineStore', () => {
  let root: string

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'om-attachment-quarantine-'))
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('stores opaque bytes and a bounded sidecar inside the configured root', async () => {
    const store = new LocalAttachmentQuarantineStore(root)
    const receipt: AttachmentScanReceipt = {
      status: 'quarantined',
      scanner: 'test-scanner',
      policy: 'required',
      checkedAt: '2026-08-21T12:00:00.000Z',
      contentSha256: 'unused-by-store',
      reasonCode: 'malware_detected',
    }

    const result = await store.quarantine({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'customer-secret.pdf',
      mimeType: 'application/pdf',
      source: 'test',
      buffer: Buffer.from('blocked content'),
      receipt,
    })

    const files = await listFiles(root)
    expect(files).toHaveLength(2)
    expect(files.every((file) => path.relative(root, file).startsWith('..') === false)).toBe(true)
    const sidecarPath = files.find((file) => file.endsWith('.json'))
    expect(sidecarPath).toBeDefined()
    const sidecar = JSON.parse(await fs.readFile(sidecarPath!, 'utf8')) as Record<string, unknown>
    expect(sidecar).toEqual(expect.objectContaining({
      quarantineId: result.quarantineId,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'quarantined',
      scanner: 'test-scanner',
      fileSize: Buffer.byteLength('blocked content'),
      contentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }))
    expect(JSON.stringify(sidecar)).not.toContain('customer-secret.pdf')

    for (const file of files) {
      const mode = (await fs.stat(file)).mode & 0o777
      expect(mode).toBe(0o600)
    }
  })
})
