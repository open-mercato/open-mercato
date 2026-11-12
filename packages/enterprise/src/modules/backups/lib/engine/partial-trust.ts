import { createHash } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { digestFile, privateFile, readBoundedFile } from './artifacts'
import { decryptBytes, identityToRecipient } from './crypto'
import { Journal } from './journal'
import { BackupError } from './errors'
export async function partialBackupDigest(directory: string): Promise<string> {
  const records: { path: string; sha256: string; bytes: number }[] = []
  for (const path of ['prepare.age','run-key.age','journal.jsonl','seal.age']) {
    if (await lstat(join(directory,path)).catch(()=>null)) records.push({path,...await digestFile(join(directory,path))})
  }
  if (!records.some((record)=>record.path==='prepare.age')) throw new BackupError('BACKUP_PARTIAL_STATE_MISSING',3)
  return createHash('sha256').update(JSON.stringify(records)).digest('hex')
}
export async function trustedPartialStatus(directory: string, workspace: string, backupId: string): Promise<{partialStateSha256:string}> {
  if (!/^[a-f0-9-]{36}$/.test(backupId)) throw new BackupError('BACKUP_INVALID_ID',2)
  const keyPath=join(workspace,`${backupId}.identity`)
  await privateFile(keyPath)
  const identity=(await readBoundedFile(keyPath,65536)).toString().trim()
  await decryptBytes(await readBoundedFile(join(directory,'prepare.age'),65*1024*1024),[identity])
  if(await lstat(join(directory,'journal.jsonl')).catch(()=>null)) {
    const journal=new Journal(join(directory,'journal.jsonl'),await identityToRecipient(identity),identity)
    for await(const value of journal.entries()){void value}
  }
  return {partialStateSha256:await partialBackupDigest(directory)}
}
