import { createHash, randomUUID } from 'node:crypto'
import { lstat,rename,unlink } from 'node:fs/promises'
import { basename,dirname,join } from 'node:path'
import { z } from 'zod'
import { manifestSchema,preparedBackupSchema,backupJournalEventSchema,type BackupIndex } from './schemas'
import { atomicStream,privateDirectory,privateFile,readBoundedFile,syncDirectory } from './artifacts'
import { bytes } from './streams'
import { decryptBytes,identityToRecipient } from './crypto'
import { readBackup } from './verify'
import { Journal } from './journal'
import { BackupError,shellQuote } from './errors'

const summarySchema=z.object({schemaVersion:z.literal(1),backupId:z.string().uuid(),entitiesDone:z.number().int().nonnegative(),entitiesTotal:z.number().int().nonnegative(),chunkCount:z.number().int().nonnegative(),totalCipherBytes:z.string().regex(/^\d+$/),consistency:z.enum(['single-snapshot','quiesced','multi-snapshot']),encryption:z.enum(['age-v1','none']),updatedAt:z.string().datetime()}).strict().refine(value=>value.entitiesDone<=value.entitiesTotal)
export type BackupSummary=z.infer<typeof summarySchema>
/** Informational only: this public checkpoint is never consulted for resume or verification trust. */
export async function publishBackupSummary(directory:string,summary:BackupSummary):Promise<void>{
  const temporary=join(directory,`summary.${randomUUID()}.json`)
  try{await atomicStream(temporary,bytes(Buffer.from(JSON.stringify(summarySchema.parse(summary)))));await rename(temporary,join(directory,'summary.json'));await syncDirectory(directory)}finally{await unlink(temporary).catch(()=>undefined)}
}
export type BackupStatusOptions={identities?:string[];workspace?:string;sourceService?:string;recipientsFile?:string;identityFile?:string;trustedManifestSha256?:string}
async function summary(directory:string):Promise<BackupSummary|undefined>{
  if(!await lstat(join(directory,'summary.json')).catch(()=>null))return
  try{return summarySchema.parse(JSON.parse((await readBoundedFile(join(directory,'summary.json'),16384)).toString()))}catch{return undefined}
}
function privateProgress(index:BackupIndex,done:Set<string>){
  const rows=new Map<string,bigint>();for(const chunk of index.chunks)if(chunk.entityKey)rows.set(chunk.entityKey,(rows.get(chunk.entityKey)??0n)+BigInt(chunk.rows))
  return {entitiesDone:done.size,entitiesTotal:index.entities.length,chunkCount:index.chunks.length,totalCipherBytes:String(index.chunks.reduce((sum,chunk)=>sum+BigInt(chunk.cipherBytes),0n)),consistency:index.consistency,entities:index.entities.map(entity=>({entityKey:entity.key,label:entity.label,done:done.has(entity.key),rowsDone:String(rows.get(entity.key)??0n)}))}
}
export async function getBackupStatus(artifact:string,options:BackupStatusOptions={}){
  if(!await lstat(artifact).catch(()=>null))throw new BackupError('BACKUP_ARTIFACT_INVALID',3)
  await privateDirectory(artifact)
  const manifestPath=join(artifact,'manifest.json'),publicSummary=await summary(artifact)
  if(await lstat(manifestPath).catch(()=>null)){
    await privateFile(manifestPath)
    const raw=await readBoundedFile(manifestPath,1024*1024),manifest=manifestSchema.parse(JSON.parse(raw.toString()))
    const observedManifestSha256=createHash('sha256').update(raw).digest('hex')
    if(options.trustedManifestSha256&&options.trustedManifestSha256!==observedManifestSha256)throw new BackupError('BACKUP_MANIFEST_TRUST_FAILED',4)
    const known=publicSummary?.backupId===manifest.backupId?publicSummary:undefined
    const output={schemaVersion:1,status:'completed',backupId:manifest.backupId,chunkCount:manifest.chunkCount,totalCipherBytes:manifest.totalCipherBytes,entitiesDone:known?.entitiesDone??null,entitiesTotal:known?.entitiesTotal??null,consistency:manifest.consistency.mode,encryption:manifest.encryption.mode,summaryAdvisory:true,updatedAt:known?.updatedAt}
    if(options.identities?.length||manifest.encryption.mode==='none'){
      const loaded=await readBackup({artifact,identities:options.identities,trustedManifestSha256:options.trustedManifestSha256??observedManifestSha256})
      return {...output,...privateProgress(loaded.index,new Set(loaded.index.entities.map(entity=>entity.key))),metadataSource:options.trustedManifestSha256?'trusted-manifest':'observed-manifest'}
    }
    return output
  }
  if(!await lstat(join(artifact,'prepare.age')).catch(()=>null))throw new BackupError('BACKUP_ARTIFACT_INVALID',3)
  let heartbeat:string|undefined,lockRunId:string|undefined
  if(await lstat(join(artifact,'lock')).catch(()=>null)){
    const lock=z.object({heartbeatAt:z.string(),runId:z.string().uuid()}).passthrough().parse(JSON.parse((await readBoundedFile(join(artifact,'lock'),4096)).toString()))
    heartbeat=lock.heartbeatAt;lockRunId=lock.runId
  }
  const pathId=/^\.([a-f0-9-]{36})\.partial$/.exec(basename(artifact))?.[1]
  let index:BackupIndex|undefined,backupId=pathId,encryption=publicSummary?.encryption
  const done=new Set<string>()
  let identity:string|undefined
  if(options.workspace&&pathId)identity=(await readBoundedFile(join(options.workspace,`${pathId}.identity`),65536)).toString().trim()
  else if(options.identities?.length)identity=(await decryptBytes(await readBoundedFile(join(artifact,'run-key.age'),65536),options.identities,4096)).toString()
  if(identity){
    const prepared=preparedBackupSchema.parse(JSON.parse((await decryptBytes(await readBoundedFile(join(artifact,'prepare.age'),65*1024*1024),[identity])).toString()))
    backupId=prepared.backupId;index=prepared.index;encryption=prepared.encryption?'age-v1':'none'
    if(pathId&&pathId!==backupId)throw new BackupError('BACKUP_BINDING_MISMATCH',4)
    if(await lstat(join(artifact,'journal.jsonl')).catch(()=>null)){
      const journal=new Journal(join(artifact,'journal.jsonl'),await identityToRecipient(identity),identity)
      for await(const raw of journal.entries({repairTail:false})){
        const event=backupJournalEventSchema.parse(raw)
        if(event.kind==='chunk')index.chunks.push(event.chunk)
        if(event.kind==='entity-complete')done.add(event.entityKey)
        if(event.kind==='restart'){index.chunks=index.chunks.filter(chunk=>chunk.entityKey!==event.entityKey);done.delete(event.entityKey)}
        if(event.kind==='epoch'){const prior=index.chunks;index=event.index;index.chunks=event.reset?[]:prior;if(event.reset)done.clear()}
      }
    }
  }
  const known=publicSummary&&(!backupId||publicSummary.backupId===backupId)?publicSummary:undefined
  const counts=index?privateProgress(index,done):{entitiesDone:known?.entitiesDone??null,entitiesTotal:known?.entitiesTotal??null,chunkCount:known?.chunkCount??null,totalCipherBytes:known?.totalCipherBytes??null,consistency:known?.consistency??null}
  const args=['create','--resume',backupId??'<backup-id>','--source-service',options.sourceService??'<same-service>','--output',dirname(artifact),'--workspace',options.workspace??'<original-workspace>']
  if(encryption==='none')args.push('--no-encryption','--confirm-unencrypted');else args.push('--recipients-file',options.recipientsFile??'<same-recipients-file>')
  if(options.identityFile)args.push('--identity-file',options.identityFile)
  if(!options.workspace)args.push('--trusted-partial-sha256','<independently-trusted-partial-digest>')
  return {schemaVersion:1,status:'resumable',backupId,...counts,encryption,heartbeatAt:heartbeat,lockRunId,summaryAdvisory:true,metadataSource:index?'decrypted-journal':'public-checkpoint',updatedAt:known?.updatedAt,resumeCommand:'mercato-backup '+args.map(shellQuote).join(' ')}
}
