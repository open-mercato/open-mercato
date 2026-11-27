/** @jest-environment node */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'

let directory: string
const children=new Set<ChildProcess>()
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'rotation-journal-sigkill-'))})
afterEach(async()=>{
  await Promise.all([...children].map(child=>new Promise<void>(done=>{if(child.exitCode!==null||child.signalCode!==null){done();return}child.once('exit',()=>done());child.kill('SIGKILL')})))
  children.clear();await rm(directory,{recursive:true,force:true})
})

type Stage={stage:string;cursor?:string[]|null;code?:string}
function launch(script:string,configuration:string,mode:string){
  const child=spawn(process.execPath,['--import',require.resolve('tsx'),script,configuration,mode],{stdio:['ignore','pipe','pipe','ipc']})
  children.add(child)
  let stderr=''
  child.stderr?.on('data',(bytes:Buffer)=>{stderr=(stderr+bytes.toString()).slice(-4096)})
  const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(done=>child.once('exit',(code,signal)=>{children.delete(child);done({code,signal})}))
  let receivedStage=false
  const stage=new Promise<Stage>((done,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Isolated journal child timed out'))},10000)
    const finish=(value:Stage)=>{receivedStage=true;clearTimeout(timeout);done(value)}
    child.once('error',error=>{clearTimeout(timeout);reject(error)})
    child.once('message',message=>finish(message as Stage))
    child.once('exit',code=>{clearTimeout(timeout);if(!receivedStage)reject(new Error(`Isolated journal child exited (${code}) before checkpoint: ${stderr}`))})
  })
  return {child,stage,exited}
}

async function fixture(){
  const identity=await generateX25519Identity(),recipient=await identityToRecipient(identity)
  const trust=join(directory,'trust');await mkdir(trust,{mode:0o700})
  const configuration=join(directory,'configuration.json')
  await writeFile(configuration,JSON.stringify({directory:join(directory,'artifacts'),tail:join(trust,'journal.tail'),header:'a'.repeat(64),key:randomBytes(32).toString('base64'),recipient,identity}),{mode:0o600})
  const script=join(directory,'journal-child.mts')
  const source=`
import {readFile} from 'node:fs/promises'
import {RotationCheckpointJournal} from ${JSON.stringify(resolve(__dirname,'../journal.ts'))}
import {RotationArtifactStore} from ${JSON.stringify(resolve(__dirname,'../store.ts'))}
import {createRotationArtifactCipher} from ${JSON.stringify(resolve(__dirname,'../age.ts'))}
const configuration=JSON.parse(await readFile(process.argv[2],'utf8'))
const mode=process.argv[3]
const store=new RotationArtifactStore(configuration.directory,createRotationArtifactCipher([configuration.recipient],[configuration.identity]))
const journal=new RotationCheckpointJournal(store,configuration.tail,configuration.header,Buffer.from(configuration.key,'base64'))
const checkpoint=cursor=>({operationId:'mapped-fixture-scope',cursor:[cursor],readRows:8,writtenRows:8})
const notify=message=>new Promise((done,reject)=>process.send(message,error=>error?reject(error):done()))
const halt=()=>new Promise(()=>setInterval(()=>{},1000))
if(mode==='seed'){
 await store.initialize();await journal.initialize(false);await journal.batch(checkpoint('before'));await notify({stage:'seeded'})
}else{
 await journal.initialize(true)
 if(mode==='resume')await notify({stage:'resumed',cursor:journal.cursor('mapped-fixture-scope')})
 else{
  if(mode==='kill-before-tail'){
   const write=store.write.bind(store)
   store.write=async(name,bytes)=>{await write(name,bytes);if(name.startsWith('journal-')){await notify({stage:'record-durable'});await halt()}}
  }
  await journal.batch(checkpoint('after'))
  await notify({stage:'tail-durable'});await halt()
 }
}
process.disconnect()
`
  await writeFile(script,source,{mode:0o600})
  const seed=launch(script,configuration,'seed');expect(await seed.stage).toEqual({stage:'seeded'});expect(await seed.exited).toEqual({code:0,signal:null})
  return {script,configuration}
}

test.each([
  ['kill-before-tail','record-durable','before'],
  ['kill-after-tail','tail-durable','after'],
])('SIGKILL %s resumes exactly the trusted committed cursor in a fresh process',async(mode,stage,cursor)=>{
  const f=await fixture()
  const writing=launch(f.script,f.configuration,mode)
  expect(await writing.stage).toEqual({stage})
  expect(writing.child.kill('SIGKILL')).toBe(true)
  expect(await writing.exited).toEqual({code:null,signal:'SIGKILL'})
  const resumed=launch(f.script,f.configuration,'resume')
  expect(await resumed.stage).toEqual({stage:'resumed',cursor:[cursor]})
  expect(await resumed.exited).toEqual({code:0,signal:null})
},30000)
