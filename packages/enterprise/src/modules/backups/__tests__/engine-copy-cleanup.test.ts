/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import { createPostgresTarget, parsePassword, parseService } from '../lib/engine/postgres'
import type { Entity, NativeOptions } from '../lib/engine/types'
const fixture=process.env.OM_BACKUP_PG_FIXTURE
const integration=fixture?describe:describe.skip
integration('native COPY input cleanup on failure (isolated fixture)',()=>{
  let admin:Client,connection:Client,database:string,directory:string,options:NativeOptions
  beforeEach(async()=>{
    const service=parseService(await readFile(join(fixture!,'service.conf'),'utf8'),'source')
    const password=parsePassword(await readFile(join(fixture!,'password'),'utf8'),{host:service.host,port:service.port,user:service.user,dbname:service.dbname})!
    const config={host:service.host,port:Number(service.port),user:service.user,password,ssl:false}
    admin=new Client({...config,database:service.dbname,statement_timeout:10000});await admin.connect()
    database=`copy_cleanup_${randomUUID().replaceAll('-','')}`;await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`)
    connection=new Client({...config,database});await connection.connect()
    directory=await mkdtemp(join(fixture!,'copy-cleanup-'))
    const serviceFile=join(directory,'service.conf'),passwordFile=join(directory,'password')
    await writeFile(serviceFile,`[target]\nhost=${service.host}\nport=${service.port}\ndbname=${database}\nuser=${service.user}\nsslmode=disable\n`,{mode:0o600})
    const escaped=password.replaceAll('\\','\\\\').replaceAll(':','\\:')
    await writeFile(passwordFile,`*:*:*:${service.user}:${escaped}\n`,{mode:0o600})
    options={targetService:'target',serviceFile,passwordFile,workspace:directory,binariesDir:join(fixture!,'bin')}
  },20000)
  afterEach(async()=>{await connection?.end();if(admin){await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH(FORCE)`);await admin.end()}if(directory)await rm(directory,{recursive:true,force:true})},20000)
  test('server COPY refusal closes the owned upstream generator without consuming its remaining rows',async()=>{
    const target=createPostgresTarget(options)
    let finalized=false,yielded=0
    async function* input(){
      try{
        yielded++;yield Buffer.from('not-an-integer\n')
        for(let i=0;i<64;i++){await delay(10);yielded++;yield Buffer.from('1\n'.repeat(512*1024))}
      }finally{finalized=true}
    }
    try{
      const identity=await target.identity()
      const confirmation=await target.challenge({backupId:'fixture',manifestSha256:'a'.repeat(64),sourceIdentity:{...identity,databaseOid:'0'}})
      await target.initialize({runId:'run',backupId:'fixture',manifestSha256:'a'.repeat(64),confirmation})
      await connection.query('CREATE TABLE copy_rows(id int NOT NULL)')
      const entity:Entity={key:'e0001',schema:'public',table:'copy_rows',columns:['id'],primaryKeys:['id'],copyFormat:'text',label:'copy_rows',estimatedRows:'1',estimatedBytes:'1'}
      await expect(target.chunk(entity,input(),{runId:'run',sequence:0,sha256:'b'.repeat(64),rows:'1'})).rejects.toThrow()
      const atFailure=yielded
      await delay(250)
      expect({finalized,additionalChunks:yielded-atFailure}).toEqual({finalized:true,additionalChunks:0})
      expect((await connection.query('SELECT count(*)::text AS n FROM copy_rows')).rows[0].n).toBe('0')
    }finally{await target.close()}
  },15000)
  test('cancelling an in-flight COPY closes the upstream generator before returning',async()=>{
    const controller=new AbortController(),target=createPostgresTarget({...options,signal:controller.signal})
    let finalized=false,yielded=0,started!:()=>void
    const copying=new Promise<void>(resolve=>{started=resolve})
    async function* input(){try{for(let i=0;i<64;i++){yielded++;started();yield Buffer.from('1\n'.repeat(512*1024));await delay(10)}}finally{finalized=true}}
    try{
      const identity=await target.identity()
      const confirmation=await target.challenge({backupId:'fixture',manifestSha256:'a'.repeat(64),sourceIdentity:{...identity,databaseOid:'0'}})
      await target.initialize({runId:'run',backupId:'fixture',manifestSha256:'a'.repeat(64),confirmation})
      await connection.query('CREATE TABLE copy_rows(id int NOT NULL)')
      const entity:Entity={key:'e0001',schema:'public',table:'copy_rows',columns:['id'],primaryKeys:['id'],copyFormat:'text',label:'copy_rows',estimatedRows:'1',estimatedBytes:'1'}
      const operation=target.chunk(entity,input(),{runId:'run',sequence:0,sha256:'b'.repeat(64),rows:'1'})
      const rejected=expect(operation).rejects.toThrow()
      await copying;controller.abort('SIGINT');await rejected
      const atFailure=yielded;await delay(250)
      expect({finalized,additionalChunks:yielded-atFailure}).toEqual({finalized:true,additionalChunks:0})
    }finally{await target.close()}
  },15000)

})
