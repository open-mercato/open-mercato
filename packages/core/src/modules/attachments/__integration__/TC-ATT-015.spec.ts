import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'

async function findJsonFiles(root: string): Promise<string[]> {
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }

  const files: string[] = []
  for (const entry of entries) {
    const entryPath = path.join(root, entry.name)
    if (entry.isDirectory()) files.push(...await findJsonFiles(entryPath))
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(entryPath)
  }
  return files
}

async function cleanupQuarantineFixture(root: string, digest: string): Promise<void> {
  const sidecars = await findJsonFiles(root)
  for (const sidecarPath of sidecars) {
    const raw = await fs.readFile(sidecarPath, 'utf8').catch(() => '')
    if (!raw) continue
    let sidecar: Record<string, unknown>
    try {
      sidecar = JSON.parse(raw) as Record<string, unknown>
    } catch {
      continue
    }
    if (sidecar.contentSha256 !== digest) continue
    await fs.rm(sidecarPath, { force: true })
    await fs.rm(sidecarPath.replace(/\.json$/, '.bin'), { force: true })
  }
}

test.describe('TC-ATT-015: attachment scanner availability policy', () => {
  test('records unavailable scans or fails closed without normal attachment persistence', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    const entityId = 'example:todo'
    const recordId = `att-015-${stamp}`
    const buffer = Buffer.from(`scanner availability fixture ${stamp}`, 'utf8')
    const digest = createHash('sha256').update(buffer).digest('hex')
    const required = process.env.OM_ATTACHMENT_SCAN_POLICY?.trim().toLowerCase() === 'required'
    const quarantineRoot = path.resolve(
      process.env.OM_ATTACHMENT_QUARANTINE_DIR?.trim()
        || path.join(process.cwd(), '.mercato', 'quarantine', 'attachments'),
    )
    let attachmentId: string | null = null

    try {
      const response = await request.post('/api/attachments', {
        headers: { Authorization: `Bearer ${token}` },
        multipart: {
          entityId,
          recordId,
          file: {
            name: 'scanner-policy.txt',
            mimeType: 'text/plain',
            buffer,
          },
        },
      })

      if (required) {
        expect(response.status(), 'required scanning blocks when no adapter is configured').toBe(503)
        const rowCount = await withClient(async (client) => {
          const result = await client.query<{ count: string }>(
            'select count(*)::text as count from attachments where entity_id = $1 and record_id = $2',
            [entityId, recordId],
          )
          return Number(result.rows[0]?.count ?? 0)
        })
        expect(rowCount, 'blocked upload creates no normal attachment row').toBe(0)
        const matchingSidecars = await findJsonFiles(quarantineRoot)
        const sidecarPayloads = await Promise.all(matchingSidecars.map(async (sidecarPath) => {
          try {
            return JSON.parse(await fs.readFile(sidecarPath, 'utf8')) as Record<string, unknown>
          } catch {
            return null
          }
        }))
        expect(sidecarPayloads.some((sidecar) => sidecar?.contentSha256 === digest)).toBe(true)
      } else {
        expect(response.status(), 'optional scanning keeps compatibility when no adapter is configured').toBe(200)
        const body = await response.json() as { item?: { id?: string } }
        attachmentId = body.item?.id ?? null
        expect(attachmentId).toBeTruthy()
        const receipt = await withClient(async (client) => {
          const result = await client.query<{ storage_metadata: Record<string, unknown> | null }>(
            'select storage_metadata from attachments where id = $1',
            [attachmentId],
          )
          const metadata = result.rows[0]?.storage_metadata
          return metadata?.securityScan as Record<string, unknown> | undefined
        })
        expect(receipt).toEqual(expect.objectContaining({
          status: 'scanner_unavailable',
          scanner: 'unavailable',
          policy: 'optional',
          contentSha256: digest,
        }))
      }
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await cleanupQuarantineFixture(quarantineRoot, digest)
    }
  })
})
