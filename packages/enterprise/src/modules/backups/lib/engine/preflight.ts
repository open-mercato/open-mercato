import type { BackupSource, Snapshot } from './types'
import { BackupError } from './errors'

export async function preflightBackup(source: BackupSource): Promise<{ identity: Snapshot['identity']; entityCount: number; catalogDigest: string }> {
  let snapshot: Snapshot | undefined
  try {
    snapshot = await source.open()
    if (![16, 17, 18].includes(snapshot.identity.serverMajor)) throw new BackupError('BACKUP_POSTGRES_MAJOR_UNSUPPORTED', 2)
    return { identity: snapshot.identity, entityCount: snapshot.entities.length, catalogDigest: snapshot.catalogDigest }
  } finally { await snapshot?.close(); await source.close() }
}
