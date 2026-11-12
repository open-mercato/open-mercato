import { randomUUID, createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { EngineContext, RestoreTarget } from './types'
import { readBackup, verifiedChunk, verifyBackup, type VerifyBackupOptions } from './verify'
import { privateDirectory, atomicStream, readBoundedFile } from './artifacts'
import { bytes } from './streams'
import { BackupError, checkAbort, shellQuote } from './errors'

export type RestoreBackupOptions = VerifyBackupOptions & EngineContext & {
  target: RestoreTarget
  confirmation: string
  workspace: string
  resume?: string
  verifyMode?: 'full' | 'streaming'
  maxStagingBytes?: number
  reportPath?: string
  resumeCommand?: (runId: string) => string
  afterDataVerified?: (target: RestoreTarget) => Promise<void>
}
export type RestoreResult = { backupId: string; restoreRunId: string; reportPath: string; status: 'completed'; quarantined: true }
async function restoreBackupInternal(options: RestoreBackupOptions): Promise<RestoreResult> {
  checkAbort(options.signal)
  await privateDirectory(options.workspace, true)
  const loaded = options.verifyMode === 'streaming' ? await readBackup(options) : await verifyBackup(options)
  const { manifest, index } = loaded
  const targetIdentity = await options.target.identity()
  if (JSON.stringify(targetIdentity) === JSON.stringify(index.identity) || targetIdentity.clusterIncarnation === index.identity.clusterIncarnation && targetIdentity.databaseOid === index.identity.databaseOid) throw new BackupError('BACKUP_SOURCE_TARGET_COLLISION', 3)
  if (targetIdentity.serverMajor !== index.identity.serverMajor || targetIdentity.encoding !== index.identity.encoding || targetIdentity.collation !== index.identity.collation) throw new BackupError('BACKUP_TARGET_INCOMPATIBLE', 3)
  const expected = await options.target.challenge({ backupId: manifest.backupId, manifestSha256: options.trustedManifestSha256, sourceIdentity: index.identity })
  if (options.confirmation !== expected) throw new BackupError('BACKUP_TARGET_CONFIRMATION_REQUIRED', 3)
  const runId = options.resume ? z.string().uuid().parse(options.resume) : randomUUID()
  const reportPath = options.reportPath ?? join(options.workspace, `${runId}.report.json`)
  if (!isAbsolute(reportPath)) throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED', 2)
  const targetIdentityDigest = createHash('sha256').update(JSON.stringify(targetIdentity)).digest('hex')
  const priorReport = await lstat(reportPath).catch(() => null)
  if (priorReport) {
    if (!options.resume || !options.target.completeFromReport) throw new BackupError('BACKUP_REPORT_ALREADY_EXISTS', 3)
    const receiptSchema = z.object({ schemaVersion: z.literal(1), backupId: z.string(), restoreRunId: z.string(), reportPath: z.string(), status: z.literal('completed'), quarantined: z.literal(true), trustedManifestSha256: z.string(), targetIdentityDigest: z.string(), completedAt: z.string() }).strict()
    const receipt = receiptSchema.parse(JSON.parse((await readBoundedFile(reportPath, 1024 * 1024)).toString()))
    if (receipt.backupId !== manifest.backupId || receipt.restoreRunId !== runId || receipt.trustedManifestSha256 !== options.trustedManifestSha256 || receipt.targetIdentityDigest !== targetIdentityDigest || receipt.reportPath !== reportPath) throw new BackupError('BACKUP_RECEIPT_BINDING_MISMATCH', 3)
    try {
      const completed = await options.target.completeFromReport({ runId, backupId: manifest.backupId, manifestSha256: options.trustedManifestSha256, confirmation: options.confirmation, reportPath, targetIdentityDigest })
      if (!completed) throw new BackupError('BACKUP_RECEIPT_INCOMPLETE', 3)
      return { backupId: manifest.backupId, restoreRunId: runId, reportPath, status: 'completed', quarantined: true }
    } finally { await options.target.close().catch(() => undefined) }
  }
  const maximum = options.maxStagingBytes ?? 1024 * 1024 * 1024
  if (maximum < 8 * 1024 * 1024) throw new BackupError('BACKUP_STAGING_LIMIT', 3)
  try {
    await options.target.initialize({ runId, backupId: manifest.backupId, manifestSha256: options.trustedManifestSha256, confirmation: options.confirmation })
    for (const section of ['pre-data', 'post-data'] as const) {
      if (section === 'post-data') break
      for (const chunk of index.chunks.filter((entry) => entry.section === section)) {
        const step = `schema:${section}:${chunk.sequence}`
        if (!await options.target.hasStep(step)) await options.target.schema(section, verifiedChunk(options, manifest, chunk), step, options.workspace)
      }
    }
    let done = 0
    for (const chunk of index.chunks.filter((entry) => entry.entityKey)) {
      checkAbort(options.signal)
      const entity = index.entities.find((entry) => entry.key === chunk.entityKey)
      if (!entity) throw new BackupError('BACKUP_UNKNOWN_ENTITY', 4)
      const step = `chunk:${entity.key}:${chunk.sequence}`
      if (!await options.target.hasStep(step)) await options.target.chunk(entity, verifiedChunk(options, manifest, chunk), { runId, sequence: chunk.sequence, sha256: chunk.sha256, rows: chunk.rows })
      done++
      options.progress?.({ schemaVersion: 1, type: 'entity.progress', runId, entity: entity.label, rowsDone: chunk.rows, rowsTotal: chunk.rows, rowsTotalExact: true, bytesDone: chunk.plainBytes, chunksDone: done, chunksTotal: index.chunks.length, at: new Date().toISOString() })
    }
    await options.target.sequences(index.sequences)
    for (const chunk of index.chunks.filter((entry) => entry.section === 'post-data')) {
      const step = `schema:post-data:${chunk.sequence}`
      if (!await options.target.hasStep(step)) await options.target.schema('post-data', verifiedChunk(options, manifest, chunk), step, options.workspace)
    }
    await options.target.foreignKeys(index.foreignKeys)
    await options.afterDataVerified?.(options.target)
    const result: RestoreResult = { backupId: manifest.backupId, restoreRunId: runId, reportPath, status: 'completed', quarantined: true }
    await atomicStream(reportPath, bytes(Buffer.from(JSON.stringify({ schemaVersion: 1, ...result, trustedManifestSha256: options.trustedManifestSha256, targetIdentityDigest, completedAt: new Date().toISOString() }))))
    await options.target.finish(reportPath)
    return result
  } catch (error) {
    const failure = error instanceof BackupError ? error : new BackupError('BACKUP_RESTORE_FAILED', 5, true)
    if (failure.resumable) failure.context = { restoreRunId: runId, resumeCommand: options.resumeCommand?.(runId) ?? `mercato-backup restore --resume ${runId} --artifact ${shellQuote(options.artifact)} --trusted-manifest-sha256 ${options.trustedManifestSha256} --confirm-target <fresh-challenge> --target-service <same-service> --workspace ${shellQuote(options.workspace)}` }
    throw failure
  } finally { await options.target.close().catch(() => undefined) }
}

export async function restoreBackup(options: RestoreBackupOptions): Promise<RestoreResult> {
  try { return await restoreBackupInternal(options) }
  finally { await options.target.close().catch(() => undefined) }
}
