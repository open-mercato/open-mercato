import { randomUUID, createHash } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import type { EngineContext, RestoreTarget } from './types'
import { readBackup, verifiedChunk, verifyBackup, verifyBackupChunks, type VerifyBackupOptions } from './verify'
import { privateDirectory, atomicStream, readBoundedFile } from './artifacts'
import { bytes } from './streams'
import { BackupError, checkAbort, shellQuote } from './errors'

export type RecoveryEvidence = {
  keyRecovery?: { status: 'passed' | 'not-tested'; testedCanaries?: number }
  checks?: { type: string; status: 'passed'; entityKey?: string }[]
}
export type RestoreBackupOptions = VerifyBackupOptions & EngineContext & {
  target: RestoreTarget
  confirmation: string
  workspace: string
  resume?: string
  jobs?: number
  verifyMode?: 'full' | 'streaming'
  maxStagingBytes?: number
  reportPath?: string
  resumeCommand?: (runId: string) => string
  afterDataVerified?: (target: RestoreTarget) => Promise<void | RecoveryEvidence>
}
export type RestoreResult = {
  backupId: string; restoreRunId: string; reportPath: string; status: 'completed'
  quarantined: true; promotionReady: false; encryption?: 'age-v1' | 'none'
}
async function restoreBackupInternal(options: RestoreBackupOptions): Promise<RestoreResult> {
  checkAbort(options.signal)
  const jobs=options.jobs??2
  if(!Number.isInteger(jobs)||jobs<1||jobs>8)throw new BackupError('BACKUP_INVALID_RESOURCE_OPTION',2)
  const attemptStartedAt=new Date().toISOString()
  const phaseDurationsMs:Record<string,number>={}
  let phaseStarted=performance.now()
  const phase=(name:string)=>{const now=performance.now();phaseDurationsMs[name]=(phaseDurationsMs[name]??0)+Math.max(0,now-phaseStarted);phaseStarted=now}
  await privateDirectory(options.workspace,true)
  const loaded=options.resume||options.verifyMode==='streaming'?await readBackup(options):await verifyBackup(options)
  phase('artifact-verification')
  const {manifest,index}=loaded
  const targetIdentity=await options.target.identity()
  if(targetIdentity.clusterIncarnation===index.identity.clusterIncarnation&&targetIdentity.databaseOid===index.identity.databaseOid)throw new BackupError('BACKUP_SOURCE_TARGET_COLLISION',3)
  if(targetIdentity.serverMajor!==index.identity.serverMajor||targetIdentity.encoding!==index.identity.encoding||targetIdentity.collation!==index.identity.collation)throw new BackupError('BACKUP_TARGET_INCOMPATIBLE',3)
  await options.target.preflightWorkers?.(jobs)
  const expected=await options.target.challenge({backupId:manifest.backupId,manifestSha256:options.trustedManifestSha256,sourceIdentity:index.identity})
  if(options.confirmation!==expected)throw new BackupError('BACKUP_TARGET_CONFIRMATION_REQUIRED',3)
  const runId=options.resume?z.string().uuid().parse(options.resume):randomUUID()
  const run={runId,backupId:manifest.backupId,manifestSha256:options.trustedManifestSha256,confirmation:options.confirmation}
  const reportPath=options.reportPath??join(options.workspace,`${runId}.report.json`)
  if(!isAbsolute(reportPath))throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED',2)
  const targetIdentityDigest=createHash('sha256').update(JSON.stringify(targetIdentity)).digest('hex')
  const result:RestoreResult={backupId:manifest.backupId,restoreRunId:runId,reportPath,status:'completed',quarantined:true,promotionReady:false,encryption:manifest.encryption.mode}
  if(await lstat(reportPath).catch(()=>null)){
    if(!options.resume||!options.target.completeFromReport)throw new BackupError('BACKUP_REPORT_ALREADY_EXISTS',3)
    const receiptSchema=z.object({schemaVersion:z.literal(1),backupId:z.string(),restoreRunId:z.string(),reportPath:z.string(),status:z.literal('completed'),quarantined:z.literal(true),trustedManifestSha256:z.string(),targetIdentityDigest:z.string(),completedAt:z.string()}).passthrough()
    const receipt=receiptSchema.parse(JSON.parse((await readBoundedFile(reportPath,64*1024*1024)).toString()))
    if(receipt.backupId!==manifest.backupId||receipt.restoreRunId!==runId||receipt.trustedManifestSha256!==options.trustedManifestSha256||receipt.targetIdentityDigest!==targetIdentityDigest||receipt.reportPath!==reportPath)throw new BackupError('BACKUP_RECEIPT_BINDING_MISMATCH',3)
    if(!await options.target.completeFromReport({...run,reportPath,targetIdentityDigest}))throw new BackupError('BACKUP_RECEIPT_INCOMPLETE',3)
    return result
  }
  if((options.maxStagingBytes??1024*1024*1024)<8*1024*1024)throw new BackupError('BACKUP_STAGING_LIMIT',3)
  if(options.resume&&options.verifyMode!=='streaming'){
    const bound=await options.target.inspectResume?.(run)
    if(bound){
      const pending=[]
      for(const chunk of index.chunks){const step=chunk.section?`schema:${chunk.section}:${chunk.sequence}`:`chunk:${chunk.entityKey}:${chunk.sequence}`;if(!await options.target.hasStep(step))pending.push(chunk)}
      await verifyBackupChunks(options,loaded,pending)
    }else await verifyBackup(options)
    phase('pending-artifact-verification')
  }
  phase('target-preflight')
  const totals=new Map<string,{rows:bigint;bytes:bigint;chunks:number}>()
  const entityChunks=new Map<string,typeof index.chunks>()
  for(const chunk of index.chunks)if(chunk.entityKey){const existing=entityChunks.get(chunk.entityKey)??[];existing.push(chunk);entityChunks.set(chunk.entityKey,existing)}
  const progress=new Map<string,{rows:bigint;bytes:bigint;chunks:number;resumedChunks:number;newRows:bigint}>()
  for(const chunk of index.chunks)if(chunk.entityKey){const total=totals.get(chunk.entityKey)??{rows:0n,bytes:0n,chunks:0};total.rows+=BigInt(chunk.rows);total.bytes+=BigInt(chunk.plainBytes);total.chunks++;totals.set(chunk.entityKey,total)}
  const overallTotal=String([...totals.values()].reduce((sum,total)=>sum+total.rows,0n))
  let overallDone=0n
  let initialized=false
  try{
    options.progress?.({schemaVersion:1,type:'run.started',runId,overallRowsDone:'0',overallRowsTotal:overallTotal,overallRowsTotalExact:true,phase:manifest.encryption.mode==='none'?'UNENCRYPTED':'encrypted',rowsDone:'0',rowsTotal:'0',rowsTotalExact:true,bytesDone:'0',chunksDone:0,chunksTotal:index.chunks.length,at:new Date().toISOString()})
    await options.target.initialize(run);initialized=true;phase('journal-initialization')
    for(const chunk of index.chunks.filter((entry)=>entry.section==='pre-data')){
      const step=`schema:pre-data:${chunk.sequence}`
      if(!await options.target.hasStep(step))await options.target.schema('pre-data',verifiedChunk(options,manifest,chunk),step,options.workspace)
    }
    phase('pre-data')
    const restoreEntity=async(entity:typeof index.entities[number],writer:Pick<RestoreTarget,'chunk'>)=>{
    for(const chunk of entityChunks.get(entity.key)??[]){
      if(failed)return
      checkAbort(options.signal)
      const applied=await options.target.hasStep(`chunk:${entity.key}:${chunk.sequence}`)
      if(!applied)await writer.chunk(entity,verifiedChunk(options,manifest,chunk),{runId,sequence:chunk.sequence,sha256:chunk.sha256,rows:chunk.rows})
      const total=totals.get(entity.key)!
      const current=progress.get(entity.key)??{rows:0n,bytes:0n,chunks:0,resumedChunks:0,newRows:0n}
      current.rows+=BigInt(chunk.rows);current.bytes+=BigInt(chunk.plainBytes);current.chunks++
      if(applied)current.resumedChunks++;else current.newRows+=BigInt(chunk.rows)
      progress.set(entity.key,current)
      overallDone+=BigInt(chunk.rows)
      options.progress?.({schemaVersion:1,type:current.chunks===total.chunks?'entity.done':'entity.progress',runId,overallRowsDone:String(overallDone),overallRowsTotal:overallTotal,overallRowsTotalExact:true,entity:entity.label,rowsDone:String(current.rows),rowsTotal:String(total.rows),rowsTotalExact:true,bytesDone:String(current.bytes),chunksDone:current.chunks,chunksTotal:total.chunks,at:new Date().toISOString()})
    }
    }
    const workers=options.target.chunkWorkers?await options.target.chunkWorkers(Math.min(jobs,Math.max(1,index.entities.length))):[options.target]
    let nextEntity=0,failed=false,firstFailure:unknown
    try{
      const outcomes=await Promise.allSettled(workers.map(async(worker)=>{
        while(!failed){const entity=index.entities[nextEntity++];if(!entity)return;try{await restoreEntity(entity,worker)}catch(error){if(!failed)firstFailure=error;failed=true;throw error}}
      }))
      const rejected=outcomes.find((outcome):outcome is PromiseRejectedResult=>outcome.status==='rejected')
      if(rejected)throw firstFailure??rejected.reason
    }finally{await Promise.allSettled(workers.filter(worker=>worker!==options.target).map(worker=>worker.close()))}
    phase('data')
    await options.target.sequences(index.sequences);phase('sequences')
    for(const chunk of index.chunks.filter((entry)=>entry.section==='post-data')){
      const step=`schema:post-data:${chunk.sequence}`
      if(!await options.target.hasStep(step))await options.target.schema('post-data',verifiedChunk(options,manifest,chunk),step,options.workspace)
    }
    phase('post-data')
    await options.target.foreignKeys(index.foreignKeys);phase('foreign-key-validation')
    const evidence=await options.afterDataVerified?.(options.target);phase('recovery-checks')
    await options.target.analyze?.();phase('analyze')
    const state=await options.target.reportState?.()
    const entities=index.entities.map((entity)=>({entityKey:entity.key,expectedRows:String(totals.get(entity.key)?.rows??0n),loadedRows:String(progress.get(entity.key)?.rows??0n),rowsLoadedThisAttempt:String(progress.get(entity.key)?.newRows??0n),resumedChunks:progress.get(entity.key)?.resumedChunks??0,plainBytes:String(progress.get(entity.key)?.bytes??0n)}))
    const report={schemaVersion:1,...result,trustedManifestSha256:options.trustedManifestSha256,targetIdentityDigest,consistency:manifest.consistency,startedAt:state?.startedAt??attemptStartedAt,attemptStartedAt,completedAt:new Date().toISOString(),resumeCount:state?.resumeCount??(options.resume?null:0),resumeTimestamps:state?.resumeTimestamps??[],entities,phaseDurationsMs,phaseDurationsScope:'current-attempt',foreignKeys:{status:'passed',checked:index.foreignKeys.length,results:index.foreignKeys.map((key,position)=>({constraintKey:`f${position+1}`,entityKey:index.entities.find((entity)=>entity.schema===key.schema&&entity.table===key.table)?.key,status:'passed'}))},keyRecovery:evidence?.keyRecovery??{status:'not-tested'},checks:evidence?.checks??[],externalAssets:{status:'not-tested'},migrationFingerprint:index.migrationFingerprint}
    await atomicStream(reportPath,bytes(Buffer.from(JSON.stringify(report))))
    await options.target.finish(reportPath)
    const rows=String([...totals.values()].reduce((sum,total)=>sum+total.rows,0n))
    options.progress?.({schemaVersion:1,type:'run.finished',runId,overallRowsDone:overallTotal,overallRowsTotal:overallTotal,overallRowsTotalExact:true,rowsDone:rows,rowsTotal:rows,rowsTotalExact:true,bytesDone:String([...totals.values()].reduce((sum,total)=>sum+total.bytes,0n)),chunksDone:index.chunks.length,chunksTotal:index.chunks.length,at:new Date().toISOString()})
    return result
  }catch(error){
    const failure=error instanceof BackupError?error:new BackupError('BACKUP_RESTORE_FAILED',5,true)
    if(initialized)failure.context.restoreRunId=runId
    if(initialized&&failure.exitCode===6){
      const failedEntityKeys=[...new Set((failure.details.foreignKeyFailures??[]).map((failed)=>index.entities.find((entity)=>entity.schema===failed.schema&&entity.table===failed.table)?.key).filter((key):key is string=>Boolean(key)))]
      const validationFailures=(failure.details.foreignKeyFailures??[]).map((failed)=>({constraintKey:`f${index.foreignKeys.findIndex((key)=>key.schema===failed.schema&&key.table===failed.table&&key.name===failed.name)+1}`,code:failure.code}))
      const failureReportPath=join(options.workspace,`${runId}.failed.${randomUUID()}.report.json`)
      try{await atomicStream(failureReportPath,bytes(Buffer.from(JSON.stringify({schemaVersion:1,backupId:manifest.backupId,restoreRunId:runId,status:'failed',quarantined:true,promotionReady:false,targetIdentityDigest,errorCode:failure.code,failedEntityKeys,validationFailures,consistency:manifest.consistency,attemptStartedAt,completedAt:new Date().toISOString(),phaseDurationsMs,keyRecovery:{status:failure.code==='BACKUP_CANARY_FAILED'?'failed':'not-tested'},externalAssets:{status:'not-tested'}}))))}
      catch(reportError){const failed=reportError instanceof BackupError?reportError:new BackupError('BACKUP_REPORT_WRITE_FAILED',5,true);failed.context={restoreRunId:runId,reportPath,resumeCommand:options.resumeCommand?.(runId)};throw failed}
      failure.context={restoreRunId:runId,reportPath:failureReportPath,validationFailureCount:validationFailures.length,failedEntityKeys}
    }
    if(initialized&&(failure.resumable||failure.exitCode===4))failure.context={...failure.context,restoreRunId:runId,resumeCommand:options.resumeCommand?.(runId)??`mercato-backup restore --resume ${runId} --artifact ${shellQuote(options.artifact)} --trusted-manifest-sha256 ${options.trustedManifestSha256} --confirm-target '<fresh-challenge>' --target-service '<same-service>' --workspace ${shellQuote(options.workspace)}`}
    throw failure
  }
}
export async function restoreBackup(options:RestoreBackupOptions):Promise<RestoreResult>{
  try{return await restoreBackupInternal(options)}finally{await options.target.close().catch(()=>undefined)}
}
