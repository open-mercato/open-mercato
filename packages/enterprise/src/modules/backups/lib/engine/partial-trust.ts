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
  const captured=new Map<string,{sha256:string;bytes:number}>()
  const capture=async(path:string,maximum:number)=>{const bytes=await readBoundedFile(join(directory,path),maximum);captured.set(path,{sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.byteLength});return bytes}
  const prepared=JSON.parse((await decryptBytes(await capture('prepare.age',65*1024*1024),[identity],65*1024*1024)).toString()) as {backupId?:unknown}
  if(prepared.backupId!==backupId)throw new BackupError('BACKUP_BINDING_MISMATCH',4)
  if(await lstat(join(directory,'run-key.age')).catch(()=>null))await capture('run-key.age',65536)
  if(await lstat(join(directory,'journal.jsonl')).catch(()=>null)) {
    const journal=new Journal(join(directory,'journal.jsonl'),await identityToRecipient(identity),identity)
    for await(const value of journal.entries({repairTail:false})){void value}
    if(!journal.lastReadSnapshot)throw new BackupError('BACKUP_PARTIAL_STATE_MISSING',3)
    captured.set('journal.jsonl',journal.lastReadSnapshot)
  }
  if(await lstat(join(directory,'seal.age')).catch(()=>null))await decryptBytes(await capture('seal.age',67*1024*1024),[identity],66*1024*1024)
  const records=['prepare.age','run-key.age','journal.jsonl','seal.age'].flatMap(path=>{const record=captured.get(path);return record?[{path,...record}]:[]})
  return {partialStateSha256:createHash('sha256').update(JSON.stringify(records)).digest('hex')}
}
