/** Real eight-entity1GiB concurrency experiment; destructive only in the opt-in disposable fixture. */
import { readFile,writeFile,mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { Client } from 'pg'
import { createBackup,restoreBackup,readBackup,createPostgresSource,createPostgresTarget } from '../lib/engine/index'
import { generateX25519Identity,identityToRecipient } from '../lib/engine/crypto'
if(process.env.OM_BACKUP_BENCHMARK_ISOLATED!=='true')throw new Error('Disposable benchmark fixture required')
const root='/bench/jobs',sourceDatabase='om_backup_jobs_source',targetDatabase='om_backup_jobs_target'
const configuration={host:'127.0.0.1',port:5432,user:'postgres',password:process.env.POSTGRES_PASSWORD}
const childJobs=process.argv.find(argument=>argument.startsWith('--jobs='))
const serviceFile=root+'/services.conf'
const native={sourceService:'source',targetService:'target',binariesDir:'/usr/lib/postgresql/16/bin',serviceFile,passwordFile:'/bench/password'}
const fingerprint=async(connection:Client)=>{
 const result=[]
 for(let table=1;table<=8;table++)result.push((await connection.query(`SELECT count(*)::text AS rows,sum(octet_length(payload))::text AS bytes,md5(string_agg(md5(id::text || ':' || payload),'' ORDER BY id)) AS content_digest FROM fixture_${table}`)).rows[0])
 return result
}
async function treeRss(pid:number):Promise<number>{
 try{
  const [status,children]=await Promise.all([readFile(`/proc/${pid}/status`,'utf8'),readFile(`/proc/${pid}/task/${pid}/children`,'utf8')])
  let total=Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]??0)*1024
  for(const child of children.trim().split(/\s+/).filter(Boolean))total+=await treeRss(Number(child))
  return total
 }catch{return 0}
}
async function runChild(jobs:number){
 if(!Number.isInteger(jobs)||jobs<1||jobs>8)throw new Error('Invalid jobs')
 const admin=new Client({...configuration,database:'postgres'});await admin.connect()
 try{await admin.query(`DROP DATABASE IF EXISTS ${targetDatabase} WITH (FORCE)`);await admin.query(`CREATE DATABASE ${targetDatabase} TEMPLATE template0`)}finally{await admin.end()}
 const workspace=`${root}/run-${jobs}`;await mkdir(workspace,{recursive:true,mode:0o700})
 const identity=await generateX25519Identity(),source=createPostgresSource({...native,workspace,jobs}),open=source.open.bind(source)
 let active=0,maxActive=0,activeRestore=0,maxRestore=0,peakNode=process.memoryUsage().rss,peakTree=0,measuring=false
 const measure=async()=>{if(measuring)return;measuring=true;try{peakNode=Math.max(peakNode,process.memoryUsage().rss);peakTree=Math.max(peakTree,await treeRss(process.pid))}finally{measuring=false}}
 const sampler=setInterval(()=>{void measure()},10)
 source.open=async()=>{const snapshot=await open(),chunks=snapshot.chunks.bind(snapshot);snapshot.chunks=async function*(entity,options){active++;maxActive=Math.max(active,maxActive);try{yield*chunks(entity,options)}finally{active--}};return snapshot}
 try{
  const backup=await createBackup({source,workspace,output:`${workspace}/output`,recipients:[await identityToRecipient(identity)],jobs,chunkSizeBytes:64*1024*1024,quiesced:true,reserveBytes:0n})
  const verify={artifact:backup.artifactPath,trustedManifestSha256:backup.manifestSha256,identities:[identity],workspace,binariesDir:native.binariesDir}
  const metadata=await readBackup(verify),target=createPostgresTarget({...native,workspace})
  const writers=target.chunkWorkers!.bind(target)
  target.chunkWorkers=async(count)=>(await writers(count)).map(worker=>({...worker,async chunk(...args){activeRestore++;maxRestore=Math.max(maxRestore,activeRestore);try{await worker.chunk(...args)}finally{activeRestore--}}}))
  const confirmation=await target.challenge({backupId:backup.backupId,manifestSha256:backup.manifestSha256,sourceIdentity:metadata.index.identity})
  await restoreBackup({...verify,target,confirmation,jobs})
  const targetConnection=new Client({...configuration,database:targetDatabase});await targetConnection.connect()
  let actual;try{actual=await fingerprint(targetConnection)}finally{await targetConnection.end()}
  const expected=JSON.parse(await readFile(root+'/expected.json','utf8')),equal=JSON.stringify(actual)===JSON.stringify(expected)
  await measure()
  const result={jobs,entityCount:8,logicalBytes:'1073741824',observedConcurrentEntityStreams:maxActive,observedConcurrentRestoreTransactions:maxRestore,completeOrderedContentDigestsEqual:equal,peakCoordinatorRssMiB:peakNode/1048576,peakCoordinatorAndNativeChildRssMiB:peakTree/1048576,rssBudgetPass:peakNode<=256*1048576,measurementScope:'fresh Node process; native-child tree from /proc; PostgreSQL server is a separate service, not coordinator child'}
  await writeFile(`${root}/jobs-${jobs}.json`,JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result))
  if(!equal||maxActive!==jobs||maxRestore!==jobs||!result.rssBudgetPass)process.exitCode=1
 }finally{clearInterval(sampler);await source.close()}
}
async function main(){
 if(childJobs){await runChild(Number(childJobs.slice(7)));return}
 await mkdir(root,{recursive:true,mode:0o700})
 await writeFile(serviceFile,`[source]\nhost=127.0.0.1\nport=5432\ndbname=${sourceDatabase}\nuser=postgres\nsslmode=disable\n[target]\nhost=127.0.0.1\nport=5432\ndbname=${targetDatabase}\nuser=postgres\nsslmode=disable\n`,{mode:0o600})
 const admin=new Client({...configuration,database:'postgres'});await admin.connect()
 try{
  await admin.query(`DROP DATABASE IF EXISTS ${sourceDatabase} WITH (FORCE)`);await admin.query(`CREATE DATABASE ${sourceDatabase} TEMPLATE template0`)
  const source=new Client({...configuration,database:sourceDatabase});await source.connect()
  try{for(let table=1;table<=8;table++)await source.query(`CREATE TABLE fixture_${table}(id int PRIMARY KEY,payload text);ALTER TABLE fixture_${table} ALTER COLUMN payload SET STORAGE EXTERNAL;INSERT INTO fixture_${table} SELECT g,repeat(md5(g::text || ':${table}'),2048) FROM generate_series(1,2048) g;ANALYZE fixture_${table}`);await writeFile(root+'/expected.json',JSON.stringify(await fingerprint(source)),{mode:0o600})}finally{await source.end()}
  const results=[]
  for(let jobs=1;jobs<=8;jobs++){
   await new Promise<void>((resolve,reject)=>{const child=spawn(process.execPath,[process.argv[1],`--jobs=${jobs}`],{env:process.env,stdio:'inherit'});child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`jobs=${jobs} failed`)))})
   results.push(JSON.parse(await readFile(`${root}/jobs-${jobs}.json`,'utf8')))
  }
  await writeFile(root+'/report.json',JSON.stringify({schemaVersion:1,runner:'documented4vCPU8GiBNode24PG16 fixture',results},null,2),{mode:0o600})
 }finally{await admin.query(`DROP DATABASE IF EXISTS ${targetDatabase} WITH (FORCE)`);await admin.query(`DROP DATABASE IF EXISTS ${sourceDatabase} WITH (FORCE)`);await admin.end()}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Benchmark failed');process.exitCode=1})
