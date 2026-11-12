/** Actual OS SIGKILL + quiesced keyset resume proof. Run only against the documented isolated native fixture. */
import {readFile,writeFile,mkdir,mkdtemp,readdir,rm,open,stat} from 'node:fs/promises'
import {join,isAbsolute} from 'node:path'
import {randomUUID} from 'node:crypto'
import {spawn,execFileSync} from 'node:child_process'
import {Client} from 'pg'
import {parseService,parsePassword,createPostgresTarget} from '../lib/engine/postgres'
import {readBackup,restoreBackup} from '../lib/engine/index'
import {generateX25519Identity,identityToRecipient} from '../lib/engine/crypto'
import {Journal} from '../lib/engine/journal'
if(process.env.OM_BACKUP_BENCHMARK_ISOLATED!=='true')throw new Error('Opt-in disposable fixture required')
const fixture=process.env.OM_BACKUP_PG_FIXTURE,cliEntry=process.env.OM_BACKUP_CLI_ENTRY,container=process.env.OM_BACKUP_PG_CONTAINER??'om-pg-9333-fixture'
if(!fixture||!isAbsolute(fixture)||!cliEntry||!isAbsolute(cliEntry)||!/^[A-Za-z0-9_.-]+$/.test(container))throw new Error('Explicit fixture, built CLI entry and safe container name required')
const service=parseService(await readFile(join(fixture,'service.conf'),'utf8'),'source')
if(service.host!=='127.0.0.1')throw new Error('Only the loopback disposable fixture is supported')
const password=parsePassword(await readFile(join(fixture,'password'),'utf8'),{host:service.host,port:service.port,user:service.user,dbname:service.dbname})!
const config={host:service.host,port:Number(service.port),user:service.user,password,ssl:false}
const admin=new Client({...config,database:service.dbname});await admin.connect()
const suffix=randomUUID().replaceAll('-',''),sourceName='crash_source_'+suffix,targetName='crash_target_'+suffix
const directory=await mkdtemp(join(fixture,'cli-process-crash-')),bin=join(directory,'bin'),output=join(directory,'output'),workspace=join(directory,'workspace')
const identity=await generateX25519Identity(),recipient=await identityToRecipient(identity)
let child:ReturnType<typeof spawn>|undefined
try{
 await admin.query(`CREATE DATABASE "${sourceName}" TEMPLATE template0`);await admin.query(`CREATE DATABASE "${targetName}" TEMPLATE template0`)
 const source=new Client({...config,database:sourceName});await source.connect()
 await source.query("CREATE TABLE fixture(id int PRIMARY KEY,payload text);ALTER TABLE fixture ALTER COLUMN payload SET STORAGE EXTERNAL;INSERT INTO fixture SELECT g,repeat(md5(g::text),512) FROM generate_series(1,8192) g")
 const digestSql="SELECT count(*)::text AS rows,md5(string_agg(md5(id::text||':'||payload),'' ORDER BY id)) AS content FROM fixture"
 const expected=(await source.query(digestSql)).rows[0];await source.end()
 await mkdir(bin,{mode:0o700});await mkdir(output,{mode:0o700});await mkdir(workspace,{mode:0o700})
 const services=(port:string)=>`[source]\nhost=127.0.0.1\nport=${port}\ndbname=${sourceName}\nuser=${service.user}\nsslmode=disable\n[target]\nhost=127.0.0.1\nport=${port}\ndbname=${targetName}\nuser=${service.user}\nsslmode=disable\n`
 const serviceFile=join(directory,'service.conf'),containerFile=join(directory,'container.conf'),recipientsFile=join(directory,'recipients')
 await writeFile(serviceFile,services(service.port),{mode:0o600});await writeFile(containerFile,services('5432'),{mode:0o600});await writeFile(recipientsFile,recipient,{mode:0o600})
 const docker=execFileSync('which',['docker'],{encoding:'utf8'}).trim()
 for(const name of ['pg_dump','pg_restore','psql'])await writeFile(join(bin,name),`#!/bin/sh\nexec '${docker}' exec -i -e PGSERVICEFILE='${containerFile}' -e PGPASSFILE='${fixture}/password' '${container}' ${name} "$@"\n`,{mode:0o700})
 const args=[cliEntry,'create','--source-service','source','--binaries-dir',bin,'--recipients-file',recipientsFile,'--output',output,'--workspace',workspace,'--chunk-size-bytes','8388608','--jobs','1','--quiesced','--progress','none','--json']
 const env={...process.env,PGSERVICEFILE:serviceFile,PGPASSFILE:join(fixture,'password'),OM_ENABLE_ENTERPRISE_MODULES:'true',OM_ENABLE_ENTERPRISE_MODULES_BACKUPS:'true',OM_ENTERPRISE_COMMERCIAL_RIGHTS_ATTESTED:'true'}
 child=spawn(process.execPath,args,{cwd:directory,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout!.on('data',part=>stdout+=part);child.stderr!.on('data',part=>stderr+=part)
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(resolve=>child!.once('exit',(code,signal)=>resolve({code,signal})))
 let partial:string|undefined,injected=false;const start=Date.now()
 while(Date.now()-start<15000){partial=(await readdir(output)).find(name=>name.endsWith('.partial'));if(partial){const journal=join(output,partial,'journal.jsonl');const lines=await readFile(journal,'utf8').catch(()=>'');if(lines.split('\n').filter(Boolean).length>=4){const handle=await open(journal,'r');await handle.sync();await handle.close();injected=true;child.kill('SIGKILL');break}}if(child.exitCode!==null)throw new Error('CLI finished before crash injection: '+stdout+stderr);await new Promise(resolve=>setTimeout(resolve,2))}
 if(!injected){child.kill('SIGKILL');await exited;throw new Error('Durable checkpoint deadline exceeded')}
 const killed=await exited;if(killed.signal!=='SIGKILL'||!partial)throw new Error('No actual SIGKILL checkpoint')
 const lockOwner=JSON.parse(await readFile(join(output,partial,'lock'),'utf8')).runId
 const backupId=partial.slice(1,-8),privateIdentity=(await readFile(join(workspace,backupId+'.identity'),'utf8')).trim(),records=[]
 for await(const event of new Journal(join(output,partial,'journal.jsonl'),await identityToRecipient(privateIdentity),privateIdentity).entries())records.push(event as {kind:string;chunk?:{entityKey?:string;path:string;sequence:number;rows:string;sha256:string}})
 const prefix=records.filter(record=>record.kind==='chunk'&&record.chunk?.entityKey).map(record=>record.chunk!)
 if(prefix.length<2)throw new Error('Insufficient committed data prefix')
 const before=await Promise.all(prefix.map(async(chunk)=>({path:chunk.path,sha256:chunk.sha256,ino:(await stat(join(output,partial!,chunk.path))).ino,mtime:(await stat(join(output,partial!,chunk.path))).mtimeMs})))
 const resumed=spawn(process.execPath,[...args,'--resume',backupId,'--take-over-lock',lockOwner],{cwd:directory,env,stdio:['ignore','pipe','pipe']});stdout='';stderr='';resumed.stdout!.on('data',part=>stdout+=part);resumed.stderr!.on('data',part=>stderr+=part)
 child=resumed
 const watchdog=setTimeout(()=>resumed.kill('SIGKILL'),30000);watchdog.unref()
 const code=await new Promise<number|null>(resolve=>resumed.once('exit',resolve));clearTimeout(watchdog);if(code!==0)throw new Error('Resume failed '+stdout+stderr)
 const result=JSON.parse(stdout);if(result.runId!==backupId)throw new Error('CLI runId contract mismatch')
 for(const file of before){const now=await stat(join(result.artifactPath,file.path));if(now.ino!==file.ino||now.mtimeMs!==file.mtime)throw new Error('Retained ciphertext prefix was rewritten')}
 const shared={artifact:result.artifactPath,trustedManifestSha256:result.manifestSha256,identities:[identity],workspace,binariesDir:bin}
 const metadata=await readBackup(shared),data=metadata.index.chunks.filter(chunk=>chunk.entityKey)
 if(data.some((chunk,index)=>chunk.sequence!==index))throw new Error('Suffix sequences not contiguous')
 const target=createPostgresTarget({targetService:'target',serviceFile,passwordFile:join(fixture,'password'),binariesDir:bin,workspace})
 const confirmation=await target.challenge({backupId,manifestSha256:result.manifestSha256,sourceIdentity:metadata.index.identity})
 await restoreBackup({...shared,target,confirmation,signal:AbortSignal.timeout(60000)})
 const restored=new Client({...config,database:targetName});await restored.connect();const actual=(await restored.query(digestSql)).rows[0];await restored.end()
 if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Full restored content mismatch')
 const report={actualSignal:killed.signal,prefixChunksRetained:prefix.length,retainedRows:prefix.reduce((sum,chunk)=>sum+Number(chunk.rows),0),totalChunks:data.length,fullContentDigestEqual:true,retainedCiphertextInodesAndMtimesUnchanged:true,consistency:metadata.index.consistency,cliRunIdMatchesBackupId:true,rows:actual.rows}
 console.log(JSON.stringify(report))
}finally{if(child?.exitCode===null)child.kill('SIGKILL');await admin.query(`DROP DATABASE IF EXISTS "${sourceName}" WITH (FORCE)`);await admin.query(`DROP DATABASE IF EXISTS "${targetName}" WITH (FORCE)`);await admin.end();await rm(directory,{recursive:true,force:true})}
