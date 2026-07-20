import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Attachment } from '@open-mercato/core/modules/attachments/data/entities'
import { OcrService } from '@open-mercato/core/modules/attachments/lib/ocrService'
import type { AgentFileInput } from './fileInput'

/**
 * Attachment-in staging (file plane, #12). Resolves the reserved `__files`
 * envelope's attachment ids under STRICT tenant+org scope, reads their bytes
 * through the attachments module's `StorageDriver`, and writes each into the run
 * sandbox `in/` dir (raw file + optional `<name>.txt` OCR sidecar). A staged file
 * is attacker-controllable, so it is treated as untrusted content: the sidecar
 * MUST reuse the existing OcrService only (never a sunsetted converter chain per
 * `.ai/lessons.md`), and any effect on domain state still flows through disposition.
 * A wrong-tenant / missing attachment THROWS — the run must fail rather than run
 * un-grounded on a file it could not read.
 */

type StorageDriverLike = {
  read(partitionCode: string, storagePath: string): Promise<{ buffer: Buffer; contentType?: string }>
}
type StorageDriverFactoryLike = {
  resolveForPartition(
    partitionCode: string,
    scope: { tenantId: string; organizationId: string },
  ): Promise<StorageDriverLike>
}
type MinimalContainer = { resolve<T = unknown>(name: string): T }

export type StagedInput = { fileName: string; hasSidecar: boolean }

/** Path-segment-free basename so a staged file can never escape the sandbox `in/` dir. */
function safeName(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 255)
  return base || 'input'
}

export async function stageAttachments(args: {
  container: MinimalContainer
  em: EntityManager
  files: AgentFileInput
  inDir: string
  tenantId: string
  organizationId: string
}): Promise<StagedInput[]> {
  if (args.files.attachments.length === 0) return []
  const factory = args.container.resolve<StorageDriverFactoryLike>('storageDriverFactory')
  const scope = { tenantId: args.tenantId, organizationId: args.organizationId }
  const staged: StagedInput[] = []

  for (const entry of args.files.attachments) {
    const attachment = await findOneWithDecryption(
      args.em,
      Attachment,
      { id: entry.attachmentId, tenantId: args.tenantId, organizationId: args.organizationId },
      undefined,
      { tenantId: args.tenantId, organizationId: args.organizationId },
    )
    if (!attachment) {
      throw new Error(`[internal] attachment ${entry.attachmentId} not found in this tenant/org; cannot stage`)
    }

    const driver = await factory.resolveForPartition(attachment.partitionCode, scope)
    const { buffer } = await driver.read(attachment.partitionCode, attachment.storagePath)
    const fileName = safeName(entry.as ?? attachment.fileName)
    const destPath = path.join(args.inDir, fileName)
    await writeFile(destPath, buffer)

    let hasSidecar = false
    if (entry.ocrText) {
      let text: string | null = attachment.content ?? null
      if (!text) {
        const ocr = new OcrService()
        if (ocr.available) {
          try {
            const result = await ocr.processFile({ filePath: destPath, mimeType: attachment.mimeType })
            text = result?.content ?? null
          } catch (err) {
            console.warn(`[internal] OCR sidecar failed for attachment ${entry.attachmentId}:`, err)
          }
        }
      }
      if (text) {
        await writeFile(`${destPath}.txt`, text, 'utf8')
        hasSidecar = true
      }
    }
    staged.push({ fileName, hasSidecar })
  }

  return staged
}
