import { constants } from 'node:fs'
import { link, open, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { VerificationResult } from './verifier'
import type { RecoveryArtifact } from './coordinator'

const reportSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), status: z.literal('passed'),
  expectedRows: z.string().regex(/^\d+$/), comparedRows: z.string().regex(/^\d+$/),
  expectedFields: z.string().regex(/^\d+$/), comparedFields: z.string().regex(/^\d+$/),
  durationMs: z.number().nonnegative(), recoveryArtifact: z.string(), recoveryDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict()

export async function publishRotationReport(path: string, result: VerificationResult, recovery: RecoveryArtifact): Promise<void> {
  const record = reportSchema.parse({ ...result, recoveryArtifact: recovery.artifactPath, recoveryDigest: recovery.digest })
  const temporary = `${path}.${randomUUID()}.partial`
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(JSON.stringify(record)); await file.sync() } finally { await file.close() }
  try {
    try { await link(temporary, path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const existing = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
      try {
        const info = await existing.stat()
        if (!info.isFile() || (info.mode & 0o077) || info.uid !== process.getuid?.() || info.size > 65536) throw new Error('[internal] ROTATION_REPORT_INVALID')
        const previous = reportSchema.parse(JSON.parse(await existing.readFile('utf8')))
        const { durationMs: _oldDuration, ...oldStable } = previous
        const { durationMs: _newDuration, ...newStable } = record
        if (JSON.stringify(oldStable) !== JSON.stringify(newStable)) throw new Error('[internal] ROTATION_REPORT_CONFLICT')
      } finally { await existing.close() }
    }
    const parent = await open(dirname(path), constants.O_RDONLY)
    try { await parent.sync() } finally { await parent.close() }
  } finally { await unlink(temporary) }
}
