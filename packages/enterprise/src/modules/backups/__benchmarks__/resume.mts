/** Opt-in destructive recovery experiment restricted to the documented disposable fixture. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { Client } from 'pg'
import { readBackup, restoreBackup, createPostgresTarget, BackupError } from '../lib/engine/index'
if(process.env.OM_BACKUP_BENCHMARK_ISOLATED!=='true')throw new Error('Disposable benchmark fixture required')
const root='/bench'
const entries=(await readdir(root+'/output')).filter(value=>/^[0-9a-f-]{36}$/.test(value))
const identities=[(await readFile(root+'/synthetic-escrow.identity','utf8')).trim()]
const expectedReport=JSON.parse(await readFile(root+'/report.json','utf8'))
let selected:{artifact:string;trustedManifestSha256:string}|undefined
for(const entry of entries){
 const artifact=root+'/output/'+entry
 // Local trust is limited to artifacts generated in this private synthetic fixture.
 const trustedManifestSha256=createHash('sha256').update(await readFile(artifact+'/manifest.json')).digest('hex')
 try{const candidate=await readBackup({artifact,trustedManifestSha256,identities});if(candidate.index.entities.length===1&&candidate.index.chunks.filter(chunk=>chunk.entityKey).reduce((sum,chunk)=>sum+BigInt(chunk.rows),0n)===BigInt(expectedReport.expected.rows)){if(selected)throw new Error('Ambiguous current fixture artifacts');selected={artifact,trustedManifestSha256}}}catch(error){if(error instanceof Error&&error.message.includes('Ambiguous'))throw error}
}
if(!selected)throw new Error('No current-identity artifact matches completed benchmark report')
const {artifact,trustedManifestSha256}=selected
const native={targetService:'resume_probe',binariesDir:'/usr/lib/postgresql/16/bin',serviceFile:root+'/resume-service.conf',passwordFile:root+'/password',workspace:root+'/workspace'}
await writeFile(native.serviceFile,(await readFile(root+'/service.conf','utf8'))+'\n[resume_probe]\nhost=127.0.0.1\nport=5432\ndbname=om_backup_resume_benchmark\nuser=postgres\nsslmode=disable\n',{mode:0o600})
const connection={host:'127.0.0.1',port:5432,user:'postgres',password:process.env.POSTGRES_PASSWORD}
const admin=new Client({...connection,database:'postgres'});await admin.connect()
let timer:NodeJS.Timeout|undefined
try{
 await admin.query('DROP DATABASE IF EXISTS om_backup_resume_benchmark WITH (FORCE)');await admin.query('CREATE DATABASE om_backup_resume_benchmark TEMPLATE template0')
 const metadata=await readBackup({artifact,trustedManifestSha256,identities})
 const binding={backupId:metadata.manifest.backupId,manifestSha256:trustedManifestSha256,sourceIdentity:metadata.index.identity}
 const initial=createPostgresTarget(native),confirmation=await initial.challenge(binding),factory=initial.chunkWorkers!.bind(initial)
 let injected=false,resume:string|undefined
 initial.chunkWorkers=async(count)=>(await factory(count)).map(worker=>({...worker,async chunk(...args){await worker.chunk(...args);if(!injected){injected=true;throw new BackupError('BACKUP_BENCHMARK_INTERRUPTED',5,true)}}}))
 const shared={artifact,trustedManifestSha256,identities,workspace:native.workspace,binariesDir:native.binariesDir}
 try{await restoreBackup({...shared,target:initial,confirmation})}catch(error){if(!(error instanceof BackupError)||error.code!=='BACKUP_BENCHMARK_INTERRUPTED')throw error;resume=error.context.restoreRunId}
 if(!resume)throw new Error('Interruption did not leave a resumable journal')
 let maxRss=process.memoryUsage().rss;timer=setInterval(()=>{maxRss=Math.max(maxRss,process.memoryUsage().rss)},25)
 const started=performance.now(),target=createPostgresTarget(native),fresh=await target.challenge(binding),initialize=target.initialize.bind(target)
 let overheadMs=0
 target.initialize=async(run)=>{await initialize(run);overheadMs=performance.now()-started}
 const restored=await restoreBackup({...shared,target,confirmation:fresh,resume})
 const result=JSON.parse(await readFile(restored.reportPath,'utf8'))
 const actualDb=new Client({...connection,database:'om_backup_resume_benchmark'});await actualDb.connect()
 const actual=(await actualDb.query("SELECT count(*)::text AS rows,sum(octet_length(payload))::text AS bytes,sum(id)::text AS ids,md5(string_agg(md5(id::text || ':' || payload),'' ORDER BY id)) AS content_digest FROM fixture")).rows[0];await actualDb.end()
 const expected=JSON.parse(await readFile(root+'/report.json','utf8')).expected
 const equal=JSON.stringify(actual)===JSON.stringify(expected)
 const report={schemaVersion:1,logicalBytes:actual.bytes,chunks:metadata.index.chunks.length,resumeOverheadMs:Math.round(overheadMs),resumeOverheadIncludes:'fresh challenge, authenticated metadata, journal binding, pending-only artifact verification, initialization',underThirtySeconds:overheadMs<=30000,resumeCount:result.resumeCount,skippedChunks:result.entities.reduce((sum:number,entity:{resumedChunks:number})=>sum+entity.resumedChunks,0),completeOrderedContentDigestEqual:equal,maxRssMiB:maxRss/1048576}
 await writeFile(root+'/resume-report.json',JSON.stringify(report,null,2),{mode:0o600});console.log(JSON.stringify(report))
 if(!equal||overheadMs>30000||report.skippedChunks!==1)process.exitCode=1
}finally{if(timer)clearInterval(timer);await admin.query('DROP DATABASE IF EXISTS om_backup_resume_benchmark WITH (FORCE)');await admin.end()}
