/** @jest-environment node */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createContainer, InjectionMode } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { register } from '../di'
import type { AttachmentScanGate } from '../lib/scanning'

async function findJsonFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(entry.parentPath, entry.name))
}

describe('attachments scanning DI', () => {
  const originalPolicy = process.env.OM_ATTACHMENT_SCAN_POLICY
  const originalQuarantineDirectory = process.env.OM_ATTACHMENT_QUARANTINE_DIR
  let quarantineDirectory: string

  beforeEach(async () => {
    quarantineDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'om-attachment-di-quarantine-'))
    process.env.OM_ATTACHMENT_SCAN_POLICY = 'required'
    process.env.OM_ATTACHMENT_QUARANTINE_DIR = quarantineDirectory
  })

  afterEach(async () => {
    if (originalPolicy === undefined) delete process.env.OM_ATTACHMENT_SCAN_POLICY
    else process.env.OM_ATTACHMENT_SCAN_POLICY = originalPolicy
    if (originalQuarantineDirectory === undefined) delete process.env.OM_ATTACHMENT_QUARANTINE_DIR
    else process.env.OM_ATTACHMENT_QUARANTINE_DIR = originalQuarantineDirectory
    await fs.rm(quarantineDirectory, { recursive: true, force: true })
  })

  it('constructs the quarantine store without treating the DI cradle as its root path', async () => {
    const container = createContainer({ injectionMode: InjectionMode.PROXY })
    register(container as unknown as AppContainer)
    const gate = container.createScope().resolve<AttachmentScanGate>('attachmentScanGate')

    await expect(gate.scan({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      fileName: 'sample.txt',
      mimeType: 'text/plain',
      source: 'test',
      buffer: Buffer.from('unscanned content'),
    })).rejects.toMatchObject({ code: 'scanner_unavailable' })

    const sidecars = await findJsonFiles(quarantineDirectory)
    expect(sidecars).toHaveLength(1)
  })
})
