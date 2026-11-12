import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'
import { encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { exerciseBackup } from '../lib/engine/exercise'
import type { RestoreTarget } from '../lib/engine/types'
import { createBackup } from '../lib/engine/create'
import { verifyBackup } from '../lib/engine/verify'
import { encryptBytes, decryptBytes, generateX25519Identity, identityToRecipient } from '../lib/engine/crypto'
import { classifyBoundary } from '../lib/engine/snapshot'
import { partialBackupDigest } from '../lib/engine/partial-trust'
import { BackupError } from '../lib/engine/errors'
import { Journal } from '../lib/engine/journal'
import type { BackupSource, Entity, Snapshot } from '../lib/engine/types'

const identity = { clusterIncarnation: 'test-cluster', databaseOid: '100', serverMajor: 16, encoding: 'UTF8', collation: 'C' }
const evidence = { xmax: '100000000000', xipList: [] as string[] }
const entity = (key: string): Entity => ({ key, schema: 'public', table: key, columns: ['id','secret'], label: 'protected entity', estimatedRows: '2', estimatedBytes: '64', primaryKeys: ['id'] })
const catalogDigest = createHash('sha256').update('catalog').digest('hex')
function source(options: { fail?: string; xmax?: string; opened?: string[]; identity?: typeof identity } = {}): BackupSource {
  return {
    async open(): Promise<Snapshot> {
      return {
        identity: options.identity ?? identity, evidence: { ...evidence, xmax: options.xmax ?? evidence.xmax }, catalogDigest, migrationFingerprint: catalogDigest, entities: [entity('e0001'), entity('e0002')], foreignKeys: [],
        async *schema(section) { yield Buffer.from(`${section} fixture`) },
        async *chunks(row) {
          options.opened?.push(row.key)
          if (options.fail === row.key) throw new Error('fixture interruption')
          yield { sequence: 0, rows: '2', stream: (async function* () { yield Buffer.from(`sensitive-data-${row.key}`) })() }
        },
        async sequences() { return [] }, async boundary() { return { identity, evidence } }, async close() {},
      }
    }, async close() {},
  }
}

describe('encrypted recovery artifacts', () => {
  let root: string
  let primary: string
  let escrow: string
  let recipients: string[]
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'om-backup-test-')); await chmod(root, 0o700)
    primary = await generateX25519Identity(); escrow = await generateX25519Identity()
    recipients = [await identityToRecipient(primary), await identityToRecipient(escrow)]
  })
  afterEach(async () => { await rm(root, { recursive: true, force: true }) })
  const options = () => ({ source: source(), output: join(root, 'out'), workspace: join(root, 'workspace'), recipients, reserveBytes: 0n, jobs: 1 })
  test('age ciphertext decrypts using offline escrow alone and rejects wrong identities', async () => {
    const encoded = await encryptBytes(Buffer.from('private fixture'), recipients)
    expect(encoded.toString()).not.toContain('private fixture')
    expect((await decryptBytes(encoded, [escrow])).toString()).toBe('private fixture')
    await expect(decryptBytes(encoded, [await generateX25519Identity()])).rejects.toThrow('BACKUP_AUTHENTICATION')
  })
  test('creates a fully encrypted artifact, verifies every chunk and reveals no entity names in manifest', async () => {
    const result = await createBackup(options())
    const artifact = await verifyBackup({ artifact: result.artifactPath, trustedManifestSha256: result.manifestSha256, identities: [escrow] })
    expect(artifact.index.chunks).toHaveLength(4)
    expect(artifact.index.entities).toHaveLength(2)
    expect((await readFile(join(result.artifactPath, 'manifest.json'),'utf8'))).not.toContain('sensitive-data')
    expect(await readdir(result.artifactPath)).not.toContain('journal.jsonl')
  })
  test('rejects a swapped manifest and a corrupted final chunk even with a correct identity', async () => {
    const result = await createBackup(options())
    await expect(verifyBackup({ artifact: result.artifactPath, trustedManifestSha256: 'a'.repeat(64), identities: [escrow] })).rejects.toThrow('MANIFEST_TRUST')
    const path = join(result.artifactPath, 'data/e0002/0.chunk')
    const encoded = await readFile(path); encoded[encoded.length - 1] ^= 1; await writeFile(path, encoded)
    await expect(verifyBackup({ artifact: result.artifactPath, trustedManifestSha256: result.manifestSha256, identities: [escrow] })).rejects.toThrow()
  })
  test('retains encrypted checkpoints after failure and resumes without reading completed entities again', async () => {
    const opened: string[] = []
    await expect(createBackup({ ...options(), source: source({ fail: 'e0002' }) })).rejects.toThrow('BACKUP_CREATE_FAILED')
    const partial = (await readdir(join(root, 'out'))).find((value) => value.endsWith('.partial'))!
    const backupId = partial.slice(1, -8)
    const result = await createBackup({ ...options(), source: source({ opened }), resume: backupId })
    expect(opened).toEqual(['e0002'])
    await expect(verifyBackup({ artifact: result.artifactPath, trustedManifestSha256: result.manifestSha256, identities: [escrow] })).resolves.toHaveProperty('index.consistency', 'quiesced')
  })
  test('refuses a non-quiescent resume before replacing the durable partial plan', async () => {
    await expect(createBackup({ ...options(), source: source({ fail: 'e0002' }), quiesced: true })).rejects.toThrow()
    const partial = (await readdir(join(root, 'out'))).find((value) => value.endsWith('.partial'))!
    const before = await readFile(join(root, 'out', partial, 'journal.jsonl'))
    await expect(createBackup({ ...options(), source: source({ xmax: '200000000000' }), quiesced: true, resume: partial.slice(1,-8) })).rejects.toThrow('QUIESCENCE')
    expect(await readFile(join(root,'out',partial,'journal.jsonl'))).toEqual(before)
  })
  test('resuming against a different database cannot mix completed chunks or mutate the journal', async () => {
    await expect(createBackup({ ...options(), source: source({ fail: 'e0002' }) })).rejects.toThrow()
    const partial = (await readdir(join(root, 'out'))).find((value) => value.endsWith('.partial'))!
    const path = join(root, 'out', partial, 'journal.jsonl')
    const before = await readFile(path)
    await expect(createBackup({ ...options(), source: source({ identity: { ...identity, databaseOid: '999' } }), resume: partial.slice(1,-8) })).rejects.toThrow('RESUME_DATABASE_MISMATCH')
    expect(await readFile(path)).toEqual(before)
  })
  test('a crash after sealing finalizes on resume without opening the source or requiring the recipient private key', async () => {
    await expect(createBackup({ ...options(), publishDirectory: async () => { throw new Error('injected publication crash') } })).rejects.toThrow('BACKUP_CREATE_FAILED')
    const partial = (await readdir(join(root, 'out'))).find((value) => value.endsWith('.partial'))!
    const opened = jest.fn().mockRejectedValue(new Error('source must not open'))
    const result = await createBackup({ ...options(), source: { open: opened, close: async () => {} }, resume: partial.slice(1,-8) })
    expect(opened).not.toHaveBeenCalled()
    await expect(verifyBackup({ artifact: result.artifactPath, trustedManifestSha256: result.manifestSha256, identities: [escrow] })).resolves.toHaveProperty('manifest.state','complete')
  })
  test('cross-host key recovery requires an independently trusted partial-state digest', async () => {
    await expect(createBackup({ ...options(), source: source({ fail:'e0002' }) })).rejects.toThrow()
    const partial=(await readdir(join(root,'out'))).find((value)=>value.endsWith('.partial'))!
    const backupId=partial.slice(1,-8)
    await unlink(join(root,'workspace',`${backupId}.identity`))
    await expect(createBackup({...options(),resume:backupId,identities:[escrow]})).rejects.toThrow('TRUSTED_PARTIAL_DIGEST_REQUIRED')
    const trustedPartialSha256=await partialBackupDigest(join(root,'out',partial))
    const result=await createBackup({...options(),resume:backupId,identities:[escrow],trustedPartialSha256})
    await expect(verifyBackup({artifact:result.artifactPath,trustedManifestSha256:result.manifestSha256,identities:[escrow]})).resolves.toHaveProperty('manifest.state','complete')
  })
  test('plaintext mode cannot bypass confirmation or deployment encryption policy', async () => {
    await expect(createBackup({ ...options(), noEncryption: true })).rejects.toThrow('UNENCRYPTED_REFUSED')
    await expect(createBackup({ ...options(), noEncryption: true, confirmUnencrypted: true, requireEncryption: true })).rejects.toThrow('UNENCRYPTED_REFUSED')
  })
  test('journal drops only a torn tail and rejects middle edits', async () => {
    const path=join(root,'journal'); const recipient=await identityToRecipient(primary)
    const first=new Journal(path,recipient,primary); await first.append({value:'private1'}); await first.append({value:'private2'})
    const data=await readFile(path,'utf8'); expect(data).not.toContain('private1')
    await writeFile(path,data+'{"incomplete":', {mode:0o600})
    expect(await new Journal(path,recipient,primary).read()).toEqual([{value:'private1'},{value:'private2'}])
    await writeFile(path,data.replace('"sequence":0','"sequence":9'))
    await expect(new Journal(path,recipient,primary).read()).rejects.toThrow('JOURNAL_INTEGRITY')
  })
  test('an output-volume attacker cannot reorder encrypted events by recomputing the public hash chain', async () => {
    const path = join(root,'reordered-journal'); const recipient=await identityToRecipient(primary)
    const writer=new Journal(path,recipient,primary);await writer.append({kind:'chunk'});await writer.append({kind:'entity-complete'})
    const lines=(await readFile(path,'utf8')).trim().split('\n').map((line)=>JSON.parse(line) as {sequence:number;previous:string;payload:string;hash:string})
    const original=lines[0].payload;lines[0].payload=lines[1].payload;lines[1].payload=original
    let previous='0'.repeat(64)
    for(const line of lines){line.previous=previous;line.hash=createHash('sha256').update(JSON.stringify({sequence:line.sequence,previous:line.previous,payload:line.payload})).digest('hex');previous=line.hash}
    await writeFile(path,lines.map((line)=>JSON.stringify(line)).join('\n')+'\n')
    await expect(new Journal(path,recipient,primary).read()).rejects.toThrow('AUTHENTICATED_POSITION')
  })
  test('concurrent chunk streams share one ciphertext output budget', async () => {
    const first=await createBackup(options())
    const reference=await verifyBackup({artifact:first.artifactPath,trustedManifestSha256:first.manifestSha256,identities:[escrow]})
    const schemaBytes=reference.index.chunks.filter((chunk)=>chunk.section).reduce((sum,chunk)=>sum+Number(chunk.cipherBytes),0)
    const dataBytes=Math.max(...reference.index.chunks.filter((chunk)=>chunk.entityKey).map((chunk)=>Number(chunk.cipherBytes)))
    const cap=schemaBytes+dataBytes
    await expect(createBackup({...options(),output:join(root,'limited-out'),workspace:join(root,'limited-workspace'),jobs:2,maxOutputBytes:cap})).rejects.toThrow('OUTPUT_LIMIT')
    const partial=(await readdir(join(root,'limited-out'))).find((value)=>value.endsWith('.partial'))!
    const directories=[join(root,'limited-out',partial,'schema'),join(root,'limited-out',partial,'data/e0001'),join(root,'limited-out',partial,'data/e0002')]
    let actual=0
    for(const directory of directories)for(const file of await readdir(directory).catch(()=>[]))if(file.endsWith('.chunk'))actual+=(await readFile(join(directory,file))).byteLength
    expect(actual).toBeLessThanOrEqual(cap)
  })
  test('exercise validates the restored canary with separately supplied historical keys and refuses wrong custody', async () => {
    const result=await createBackup(options())
    const key=randomBytes(32).toString('base64')
    const canary='synthetic-offline-escrow-canary'
    const envelope=encryptWithAesGcm(canary,key).value
    const checksFile=join(root,'checks.json'),canaryKeysFile=join(root,'keys.json')
    await writeFile(checksFile,JSON.stringify([{type:'migration-fingerprint'},{type:'row-count',entityKey:'e0001',minimum:'2',maximum:'2'},{type:'encrypted-canary',entityKey:'e0001',field:'secret',key:{id:'1'},keyHandle:'offline',expectedSha256:createHash('sha256').update(canary).digest('hex')}]),{mode:0o600})
    await writeFile(canaryKeysFile,JSON.stringify({offline:key}),{mode:0o600})
    const drain=async(stream:AsyncIterable<Uint8Array>)=>{for await(const value of stream){void value}}
    const target=():RestoreTarget=>({
      async identity(){return {...identity,clusterIncarnation:'target-cluster',databaseOid:'200'}},async challenge(){return 'CONFIRM'},async initialize(){},async hasStep(){return false},
      async schema(_section,stream){await drain(stream)},async chunk(_entity,stream){await drain(stream)},async sequences(){},async foreignKeys(){},async countRows(){return '2'},async finish(){},async close(){},async migrationFingerprint(){return catalogDigest},async readCanary(){return envelope},
    })
    const shared={artifact:result.artifactPath,trustedManifestSha256:result.manifestSha256,identities:[escrow],workspace:join(root,'recover'),confirmation:'CONFIRM',checksFile,canaryKeysFile}
    await expect(exerciseBackup({...shared,target:target()})).resolves.toHaveProperty('quarantined',true)
    await writeFile(canaryKeysFile,JSON.stringify({offline:randomBytes(32).toString('base64')}))
    await expect(exerciseBackup({...shared,target:target()})).rejects.toThrow('BACKUP_CANARY_FAILED')
    const absent={...target(),initialize:jest.fn(async()=>{})}
    await expect(exerciseBackup({...shared,target:absent,canaryKeysFile:undefined})).rejects.toThrow('CANARY_CUSTODY_REQUIRED')
    expect(absent.initialize).not.toHaveBeenCalled()
  })
  test('a bounded worker connection retry reuses the held snapshot and restarts that entity exactly once', async () => {
    const fixture=source();const open=fixture.open.bind(fixture);let attempts=0
    fixture.open=jest.fn(async()=>{
      const snapshot=await open();const chunks=snapshot.chunks.bind(snapshot)
      snapshot.chunks=async function*(entity,request){
        if(entity.key==='e0001'&&attempts++===0){yield*chunks(entity,request);throw new BackupError('BACKUP_COPY_READ_FAILED',5,true)}
        yield*chunks(entity,request)
      }
      return snapshot
    })
    const result=await createBackup({...options(),source:fixture})
    const verified=await verifyBackup({artifact:result.artifactPath,trustedManifestSha256:result.manifestSha256,identities:[escrow]})
    expect(fixture.open).toHaveBeenCalledTimes(1)
    expect(verified.index.epochs).toBe(1);expect(verified.index.consistency).toBe('single-snapshot')
    expect(verified.index.chunks.filter((chunk)=>chunk.entityKey==='e0001')).toHaveLength(1)
  })
  test('equal horizon with in-flight transactions is never proof of quiescence', () => {
    expect(classifyBoundary({identity,evidence:{...evidence,xipList:['99']}},{identity,evidence},'single-snapshot')).toBe('multi-snapshot')
    expect(classifyBoundary({identity,evidence},{identity,evidence},'multi-snapshot')).toBe('multi-snapshot')
  })
})
