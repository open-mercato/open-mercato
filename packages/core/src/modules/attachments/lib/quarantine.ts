import { createHash, randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveContainedPath } from './pathContainment'
import type { AttachmentScanInput, AttachmentScanReceipt } from './scanning'

export type AttachmentQuarantineInput = Omit<AttachmentScanInput, 'signal'> & {
  receipt: AttachmentScanReceipt
}

export type AttachmentQuarantineResult = {
  quarantineId: string
}

export interface AttachmentQuarantineStore {
  quarantine(input: AttachmentQuarantineInput): Promise<AttachmentQuarantineResult>
}

export type AttachmentQuarantineSidecar = {
  quarantineId: string
  tenantId: string
  organizationId: string
  source: string
  mimeType: string
  fileSize: number
  contentSha256: string
  status: AttachmentScanReceipt['status']
  scanner: string
  reasonCode: string | null
  checkedAt: string
}

export function resolveAttachmentQuarantineRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.OM_ATTACHMENT_QUARANTINE_DIR?.trim()
  return path.resolve(configured || path.join(process.cwd(), '.mercato', 'quarantine', 'attachments'))
}

function safeScopeSegment(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128)
  return normalized || 'unknown'
}

function boundedSidecarValue(value: string, maxLength: number, fallback: string): string {
  const normalized = value.trim().slice(0, maxLength)
  return normalized || fallback
}

export class LocalAttachmentQuarantineStore implements AttachmentQuarantineStore {
  constructor(private readonly root = resolveAttachmentQuarantineRoot()) {}

  async quarantine(input: AttachmentQuarantineInput): Promise<AttachmentQuarantineResult> {
    const quarantineId = randomUUID()
    const checkedAt = new Date(input.receipt.checkedAt)
    const safeDate = Number.isNaN(checkedAt.getTime()) ? new Date() : checkedAt
    const relativeDirectory = path.join(
      String(safeDate.getUTCFullYear()),
      String(safeDate.getUTCMonth() + 1).padStart(2, '0'),
      String(safeDate.getUTCDate()).padStart(2, '0'),
      safeScopeSegment(input.tenantId),
      safeScopeSegment(input.organizationId),
    )
    const directory = resolveContainedPath(this.root, relativeDirectory)
    const blobPath = resolveContainedPath(this.root, path.join(relativeDirectory, `${quarantineId}.bin`))
    const sidecarPath = resolveContainedPath(this.root, path.join(relativeDirectory, `${quarantineId}.json`))
    const sidecar: AttachmentQuarantineSidecar = {
      quarantineId,
      tenantId: boundedSidecarValue(input.tenantId, 128, 'unknown'),
      organizationId: boundedSidecarValue(input.organizationId, 128, 'unknown'),
      source: boundedSidecarValue(input.source, 100, 'unknown'),
      mimeType: boundedSidecarValue(input.mimeType, 255, 'application/octet-stream'),
      fileSize: input.buffer.length,
      contentSha256: createHash('sha256').update(input.buffer).digest('hex'),
      status: input.receipt.status,
      scanner: input.receipt.scanner,
      reasonCode: input.receipt.reasonCode,
      checkedAt: safeDate.toISOString(),
    }

    let blobWritten = false
    let sidecarAttempted = false
    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      await fs.chmod(directory, 0o700)
      await fs.writeFile(blobPath, input.buffer, { flag: 'wx', mode: 0o600 })
      blobWritten = true
      sidecarAttempted = true
      await fs.writeFile(sidecarPath, `${JSON.stringify(sidecar)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      })
      return { quarantineId }
    } catch (error) {
      if (sidecarAttempted) await fs.rm(sidecarPath, { force: true }).catch(() => undefined)
      if (blobWritten) await fs.rm(blobPath, { force: true }).catch(() => undefined)
      throw error
    }
  }
}
