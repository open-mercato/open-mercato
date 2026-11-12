import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { EngineContext, RestoreTarget } from './types'
import { readBackup, verifiedChunk, verifyBackup, type VerifyBackupOptions } from './verify'
import { privateDirectory, atomicStream } from './artifacts'
import { bytes } from './streams'
import { BackupError, checkAbort } from './errors'

export type RestoreBackupOptions = VerifyBackupOptions & EngineContext & {
  target: RestoreTarget
  confirmation: string
  workspace: string
  resume?: string
  verifyMode?: 'full' | 'streaming'
  maxStagingBytes?: number
  reportPath?: string
  afterDataVerified?: (target: RestoreTarget) => Promise<void>
}
export type RestoreResult = { backupId: string; restoreRunId: string; reportPath: string; status: 'completed'; quarantined: true }
export async function restoreBackup(options: RestoreBackupOptions): Promise<RestoreResult> {
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
  const maximum = options.maxStagingBytes ?? 1024 * 1024 * 1024
  if (maximum < 8 * 1024 * 1024) throw new BackupError('BACKUP_STAGING_LIMIT', 3)
  try {
    await options.target.initialize({ runId, backupId: manifest.backupId, manifestSha256: options.trustedManifestSha256, confirmation: options.confirmation })
    for (const section of ['pre-data', 'post-data'] as const) {
      if (section === 'post-data') break
      for (const chunk of index.chunks.filter((entry) => entry.section === section)) {
        const step = `schema:${section}:${chunk.sequence}`
        if (!await options.target.hasStep(step)) await options.target.schema(section, verifiedChunk(options, manifest, chunk), step)
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
      if (!await options.target.hasStep(step)) await options.target.schema('post-data', verifiedChunk(options, manifest, chunk), step)
    }
    await options.target.foreignKeys(index.foreignKeys)
    await options.afterDataVerified?.(options.target)
    const reportPath = options.reportPath ?? join(options.workspace, `${runId}.report.json`)
    if (!isAbsolute(reportPath)) throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED', 2)
    const result: RestoreResult = { backupId: manifest.backupId, restoreRunId: runId, reportPath, status: 'completed', quarantined: true }
    await atomicStream(reportPath, bytes(Buffer.from(JSON.stringify({ schemaVersion: 1, ...result, trustedManifestSha256: options.trustedManifestSha256, completedAt: new Date().toISOString() }))))
    await options.target.finish(reportPath)
    return result
  } catch (error) {
    const failure = error instanceof BackupError ? error : new BackupError('BACKUP_RESTORE_FAILED', 5, true)
    if (failure.resumable) failure.context = { restoreRunId: runId, resumeCommand: `mercato-backup restore --resume ${runId} --artifact ${JSON.stringify(options.artifact)} --trusted-manifest-sha256 ${options.trustedManifestSha256} --confirm-target <fresh-challenge> --target-service <same-service> --workspace ${JSON.stringify(options.workspace)}` }
    throw failure
  } finally { await options.target.close().catch(() => undefined) }
}
