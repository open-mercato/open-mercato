/** @jest-environment node */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { generateX25519Identity, identityToRecipient } from '../../engine/crypto'
import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'

// These tests exercise real process death and production coordinator/store/age
// durability. The committed row is a tiny fsynced fixture, not PostgreSQL/Core SQL.
let directory: string
const children = new Set<ChildProcess>()
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rotation-coordinator-sigkill-')) })
afterEach(async () => {
  await Promise.all([...children].map(child => new Promise<void>(done => {
    if (child.exitCode !== null || child.signalCode !== null) return done()
    child.once('exit', () => done()); child.kill('SIGKILL')
  })))
  children.clear(); await rm(directory, { recursive: true, force: true })
})

type Message = { stage: string; error?: string }
function launch(script: string, configuration: string, mode: string, boundary: string) {
  const child = spawn(process.execPath, ['--import', require.resolve('tsx'), script, configuration, mode, boundary], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
  children.add(child)
  let stderr = '', received = false
  child.stderr?.on('data', (bytes: Buffer) => { stderr = (stderr + bytes.toString()).slice(-4096) })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(done => child.once('exit', (code, signal) => { children.delete(child); done({ code, signal }) }))
  const message = new Promise<Message>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Coordinator crash child timed out')) }, 15000)
    child.once('message', value => { received = true; clearTimeout(timer); done(value as Message) })
    child.once('error', error => { clearTimeout(timer); reject(error) })
    child.once('exit', code => { clearTimeout(timer); if (!received) reject(new Error(`Coordinator crash child exited (${code}) before notification: ${stderr}`)) })
  })
  return { child, message, exited }
}

async function fixture() {
  const identity = await generateX25519Identity(), recipient = await identityToRecipient(identity)
  const source = randomBytes(32).toString('base64'), target = randomBytes(32).toString('base64')
  const trust = join(directory, 'trust'); await mkdir(trust, { mode: 0o700 })
  const configuration = join(directory, 'configuration.json')
  await writeFile(configuration, JSON.stringify({ directory, trust, source, target, identity, recipient }), { mode: 0o600 })
  await writeFile(join(directory, 'row.json'), JSON.stringify({ ciphertext: encryptWithAesGcm('original', source).value, timestamp: '2026-01-01T00:00:00.123Z' }), { mode: 0o600 })
  const script = join(directory, 'coordinator-child.mts')
  await writeFile(script, `
import {readFile,writeFile,open,rename} from 'node:fs/promises'
import {join} from 'node:path'
import {createEnterpriseRotationProtection} from ${JSON.stringify(resolve(__dirname, '../coordinator.ts'))}
import {RotationArtifactStore} from ${JSON.stringify(resolve(__dirname, '../store.ts'))}
import {RotationCheckpointJournal} from ${JSON.stringify(resolve(__dirname, '../journal.ts'))}
import {createRotationArtifactCipher} from ${JSON.stringify(resolve(__dirname, '../age.ts'))}
import {publishRotationReport,publishRotationFailureReport} from ${JSON.stringify(resolve(__dirname, '../report.ts'))}
import {encryptWithAesGcm,decryptWithAesGcm} from ${JSON.stringify(resolve(__dirname, '../../../../../../../shared/src/lib/encryption/aes.ts'))}
import {canonicalRotationTimestamp} from ${JSON.stringify(resolve(__dirname, '../postgres-dataset.ts'))}
const c=JSON.parse(await readFile(process.argv[2],'utf8')),mode=process.argv[3],boundary=process.argv[4]
const notify=message=>new Promise((done,reject)=>process.send(message,error=>error?reject(error):done()))
const halt=()=>new Promise(()=>setInterval(()=>{},1000))
const at=async stage=>{if((mode==='crash'||mode==='resume-crash')&&stage===boundary){await notify({stage});await halt()}}
const durable=async(path,value)=>{const temp=path+'.partial';const f=await open(temp,'w',0o600);try{await f.writeFile(JSON.stringify(value));await f.sync()}finally{await f.close()}await rename(temp,path);const d=await open(c.directory,'r');try{await d.sync()}finally{await d.close()}}
const event=async name=>{const f=await open(join(c.directory,'events'),'a',0o600);try{await f.writeFile(name+'\\n');await f.sync()}finally{await f.close()}}
const row=async()=>JSON.parse(await readFile(join(c.directory,'row.json'),'utf8'))
let id=mode.startsWith('resume')?await readFile(join(c.directory,'run-id'),'utf8'):undefined
const originalWrite=RotationArtifactStore.prototype.write
RotationArtifactStore.prototype.write=async function(name,bytes){let label=name.startsWith('intent-')?'intent-page':name;if(name==='checkpoint')label+='-'+JSON.parse(Buffer.from(bytes).toString()).status;await at('seal-'+label+'-before');await originalWrite.call(this,name,bytes);await at('seal-'+label+'-after')}
const originalLinks=RotationArtifactStore.prototype.linkNames
RotationArtifactStore.prototype.linkNames=async function(...args){await at('intent-links-before');await originalLinks.apply(this,args);await at('intent-links-after')}
const originalAppend=RotationCheckpointJournal.prototype.append
RotationCheckpointJournal.prototype.append=async function(event){const label=event.kind==='batch'?'batch':event.status;await at('journal-'+label+'-before');await originalAppend.call(this,event);await at('journal-'+label+'-after')}
let datasets=0
const providers={provider:'explicit-fixture',kms:{},previousKms:{},async refresh(){}}
const options={artifactRoot:join(c.directory,'artifacts'),trustRoot:c.trust,resumeId:id,
 async assertEntitlement(){},async providers(){return providers},
 async reportRun(runId){id=runId;await writeFile(join(c.directory,'run-id'),id,{mode:0o600})},
 async dataset(context,p,backupDigest,intents){datasets++;if(datasets===3&&mode==='crash')await at('trusted-prepared-after');return{
  async assertFence(){},async binding(){return{database:c.database??'fixture-db',scope:'fixture-scope',schema:'fixture-schema',coverage:'all',provider:providers.provider,backupDigest}},
  async keys(){return{source:c.source,target:c.target,provider:providers.provider}},
  async *rows(phase){await event('scan-'+phase);const r=await row();const value=decryptWithAesGcm(r.ciphertext,phase==='before'?c.source:c.target);if(value===null)throw new Error('ROTATION_TARGET_KEY_FAILED');yield{entity:'public.custom_entities_storage',tenantId:'fixture-tenant',organizationId:null,identity:['fixture-row'],columns:[{name:'secret',type:'text',value}],metadata:{updated_at:canonicalRotationTimestamp(r.timestamp)},...(phase==='after'?{metadataIntent:await intents.load(JSON.stringify(['public.custom_entities_storage','fixture-tenant',null,['fixture-row']]))}:{})}}
 }},
 recovery:{async create(){await event('backup-create');return{artifactPath:'/fixture-backup',digest:'a'.repeat(64),databaseBinding:'fixture-db',consistency:'quiesced',encrypted:true}},async verify(){await event('backup-verify')}},
 async cipher(){return createRotationArtifactCipher([c.recipient],[c.identity])},
 async report(result,recovery){await at('report-before');await publishRotationReport(join(c.trust,result.runId+'.report.json'),result,recovery);await at('report-after')},
 async reportFailure(code,recovery,runId,status,details){await event('failure-report');await publishRotationFailureReport(join(c.trust,runId+'.failure.json'),code,recovery,runId,status,details)}
}
try{
 await createEnterpriseRotationProtection(options).protect({tenantId:'fixture-tenant',organizationId:null,previousKey:'fixture-source',dryRun:false,entityManager:{}},async p=>{
  await at('rotation-before');const cursor=await p.resumeCursor('fixture-operation');await event('cursor-'+(cursor?.[0]??'none'))
  if(!cursor){const r=await row();let written=0
   if(decryptWithAesGcm(r.ciphertext,c.target)===null){const timestamp=await p.timestampForWrite({table:'custom_entities_storage',identity:'fixture-row',tenantId:'fixture-tenant',organizationId:null,previousTimestamp:r.timestamp});await at('batch-write-before');await durable(join(c.directory,'row.json'),{ciphertext:encryptWithAesGcm(decryptWithAesGcm(r.ciphertext,c.source),c.target).value,timestamp:timestamp.toISOString()});await event('row-write');written=1;await at('batch-write-after')}
   await p.checkpointBatch({operationId:'fixture-operation',cursor:['fixture-row'],readRows:1,writtenRows:written})
  }
 })
 await at('trusted-passed-after');await notify({stage:'completed'})
}catch(error){await notify({stage:'refused',error:String(error.message)})}
process.disconnect()
`, { mode: 0o600 })
  return { script, configuration, trust }
}

async function state(trust: string) {
  const files = (await readdir(trust)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))
  return files.length ? JSON.parse(await readFile(join(trust, files[0]!), 'utf8')) : undefined
}
async function ageDeadLock(trust: string, child: ChildProcess) {
  expect(() => process.kill(child.pid!, 0)).toThrow()
  const path = join(trust, 'rotation.lock'), record = JSON.parse(await readFile(path, 'utf8'))
  expect(record.pid).toBe(child.pid)
  // Only the stale-lock age is advanced; no baseline, journal or data is changed.
  record.startedAt = new Date(Date.now() - 61000).toISOString()
  await writeFile(path, JSON.stringify(record), { mode: 0o600 })
}
async function baselineHashes(record: { id: string }) {
  const root = join(directory, 'artifacts', record.id)
  const names = (await readdir(root)).filter(name => /^(header|run-key|chunk-[0-9]+)\.age$/.test(name))
  return Object.fromEntries(await Promise.all(names.map(async name => [name, createHash('sha256').update(await readFile(join(root, name))).digest('hex')])) )
}

const boundaries = [
  'seal-run-key-before', 'seal-run-key-after', 'seal-chunk-000000000000-before', 'seal-chunk-000000000000-after', 'seal-header-before', 'seal-header-after', 'seal-checkpoint-prepared-before', 'seal-checkpoint-prepared-after',
  'trusted-prepared-after', 'journal-rotating-before', 'journal-rotating-after', 'rotation-before',
  'seal-intent-page-before', 'seal-intent-page-after', 'intent-links-before', 'intent-links-after', 'batch-write-before', 'batch-write-after', 'journal-batch-before', 'journal-batch-after',
  'journal-verifying-before', 'journal-verifying-after', 'seal-checkpoint-verifying-before', 'seal-checkpoint-verifying-after', 'seal-checkpoint-passed-before', 'seal-checkpoint-passed-after',
  'report-before', 'report-after', 'journal-passed-before', 'journal-passed-after', 'trusted-passed-after',
]
test.each(boundaries)('SIGKILL at %s cannot rebaseline committed data or skip the final comparison', async boundary => {
  const f = await fixture(), first = launch(f.script, f.configuration, 'crash', boundary)
  expect(await first.message).toEqual({ stage: boundary })
  expect(first.child.kill('SIGKILL')).toBe(true)
  expect(await first.exited).toEqual({ code: null, signal: 'SIGKILL' })
  const original = await state(f.trust), hashes = original ? await baselineHashes(original) : undefined
  const terminalState = original?.status === 'passed' ? await readFile(join(f.trust, original.id + '.json')) : undefined
  const terminalReceipt = original?.status === 'passed' ? await readFile(join(f.trust, original.prepared.runId + '.report.json')) : undefined
  if (original?.status !== 'passed') await ageDeadLock(f.trust, first.child)
  const resumed = launch(f.script, f.configuration, 'resume', '')
  const result = await resumed.message
  expect(await resumed.exited).toEqual({ code: 0, signal: null })
  if (!original) {
    expect(result.stage).toBe('refused')
    expect(await state(f.trust)).toBeUndefined()
  } else if (original.status === 'passed') {
    expect(result).toMatchObject({ stage: 'refused', error: expect.stringContaining('ROTATION_ALREADY_COMPLETED') })
    expect((await state(f.trust)).status).toBe('passed')
    expect(await readFile(join(f.trust, original.id + '.json'))).toEqual(terminalState)
    expect(await readFile(join(f.trust, original.prepared.runId + '.report.json'))).toEqual(terminalReceipt)
    expect((await readdir(f.trust)).filter(name => name.endsWith('.failure.json'))).toEqual([])
  } else {
    expect(result).toEqual({ stage: 'completed' })
    expect((await state(f.trust)).prepared).toEqual(original.prepared)
    expect(await baselineHashes(original)).toEqual(hashes)
  }
  const events = (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n')
  expect(events.filter(event => event === 'backup-create')).toHaveLength(1)
  expect(events.filter(event => event === 'scan-before')).toHaveLength(boundary === 'seal-run-key-before' || boundary === 'seal-run-key-after' ? 0 : 1)
  expect(events.filter(event => event === 'row-write').length).toBeLessThanOrEqual(1)
  if (original && original.status !== 'passed') expect(events.at(-1)).toBe('scan-after')
  const committedCursor = boundaries.indexOf(boundary) >= boundaries.indexOf('journal-batch-after')
  if (original && original.status !== 'passed') expect(events.filter(event => event.startsWith('cursor-')).at(-1)).toBe(committedCursor ? 'cursor-fixture-row' : 'cursor-none')
  if (!original) expect(events).not.toContain('row-write')
}, 30000)

test.each(['logical-value', 'timestamp'])('SIGKILL after commit cannot authenticate changed %s on resume', async damage => {
  const f = await fixture(), first = launch(f.script, f.configuration, 'crash', 'batch-write-after')
  expect(await first.message).toEqual({ stage: 'batch-write-after' })
  first.child.kill('SIGKILL'); expect(await first.exited).toEqual({ code: null, signal: 'SIGKILL' })
  const original = await state(f.trust), hashes = await baselineHashes(original)
  await ageDeadLock(f.trust, first.child)
  const rowPath = join(directory, 'row.json'), row = JSON.parse(await readFile(rowPath, 'utf8'))
  if (damage === 'logical-value') {
    const configuration = JSON.parse(await readFile(f.configuration, 'utf8'))
    row.ciphertext = encryptWithAesGcm('wrong-but-valid-target-ciphertext', configuration.target).value
  } else row.timestamp = '2031-01-01T00:00:00.000Z'
  await writeFile(rowPath, JSON.stringify(row), { mode: 0o600 })
  const resumed = launch(f.script, f.configuration, 'resume', '')
  expect(await resumed.message).toMatchObject({ stage: 'refused', error: expect.stringMatching(/ROTATION_(DATA|METADATA)_MISMATCH/) })
  expect(await resumed.exited).toEqual({ code: 0, signal: null })
  expect((await state(f.trust)).prepared).toEqual(original.prepared)
  expect((await state(f.trust)).status).toBe('failed')
  expect(await baselineHashes(original)).toEqual(hashes)
  expect((await readdir(f.trust)).filter(name => name.endsWith('.report.json'))).toEqual([])
  const events = (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n')
  expect(events.filter(event => event === 'scan-before')).toHaveLength(1)
  expect(events.filter(event => event === 'row-write')).toHaveLength(1)
  expect(events).toContain('scan-after')
}, 30000)

test('repeated SIGKILL after committed checkpoint and durable report repeats the complete final scan', async () => {
  const f = await fixture(), first = launch(f.script, f.configuration, 'crash', 'journal-batch-after')
  expect(await first.message).toEqual({ stage: 'journal-batch-after' })
  first.child.kill('SIGKILL'); expect(await first.exited).toEqual({ code: null, signal: 'SIGKILL' })
  const original = await state(f.trust), hashes = await baselineHashes(original)
  await ageDeadLock(f.trust, first.child)
  const second = launch(f.script, f.configuration, 'resume-crash', 'report-after')
  expect(await second.message).toEqual({ stage: 'report-after' })
  second.child.kill('SIGKILL'); expect(await second.exited).toEqual({ code: null, signal: 'SIGKILL' })
  await ageDeadLock(f.trust, second.child)
  const third = launch(f.script, f.configuration, 'resume', '')
  expect(await third.message).toEqual({ stage: 'completed' })
  expect(await third.exited).toEqual({ code: 0, signal: null })
  expect((await state(f.trust)).status).toBe('passed')
  expect((await state(f.trust)).prepared).toEqual(original.prepared)
  expect(await baselineHashes(original)).toEqual(hashes)
  const events = (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n')
  expect(events.filter(event => event === 'scan-before')).toHaveLength(1)
  expect(events.filter(event => event === 'scan-after')).toHaveLength(2)
  expect(events.filter(event => event === 'row-write')).toHaveLength(1)
  expect(events.filter(event => event === 'backup-create')).toHaveLength(1)
  expect(events.filter(event => event === 'cursor-fixture-row')).toHaveLength(2)
}, 30000)

test.each(['database', 'run-id'])('an unadmitted %s resume preserves the crashed trusted state without failure publication', async mismatch => {
  const f = await fixture(), first = launch(f.script, f.configuration, 'crash', 'rotation-before')
  expect(await first.message).toEqual({ stage: 'rotation-before' })
  first.child.kill('SIGKILL'); expect(await first.exited).toEqual({ code: null, signal: 'SIGKILL' })
  const original = await state(f.trust), statePath = join(f.trust, original.id + '.json')
  await ageDeadLock(f.trust, first.child)
  if (mismatch === 'database') {
    const configuration = JSON.parse(await readFile(f.configuration, 'utf8'))
    await writeFile(f.configuration, JSON.stringify({ ...configuration, database: 'different-database' }), { mode: 0o600 })
  } else await writeFile(statePath, JSON.stringify({ ...original, id: randomUUID() }), { mode: 0o600 })
  const trusted = await readFile(statePath)
  const resumed = launch(f.script, f.configuration, 'resume', '')
  expect(await resumed.message).toMatchObject({ stage: 'refused', error: expect.stringContaining('ROTATION_RESUME_INVALID') })
  expect(await resumed.exited).toEqual({ code: 0, signal: null })
  expect(await readFile(statePath)).toEqual(trusted)
  expect((await readdir(f.trust)).filter(name => name.endsWith('.failure.json') || name.endsWith('.report.json'))).toEqual([])
  const events = (await readFile(join(directory, 'events'), 'utf8')).trim().split('\n')
  expect(events).not.toContain('failure-report')
  expect(events).not.toContain('row-write')
  expect(events.some(event => event.startsWith('cursor-'))).toBe(false)
}, 30000)
