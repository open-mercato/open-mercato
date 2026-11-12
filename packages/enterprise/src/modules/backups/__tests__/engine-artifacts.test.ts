import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { createBackup } from '../lib/engine/create'
import { verifyBackup } from '../lib/engine/verify'
import { encryptBytes, decryptBytes, generateX25519Identity, identityToRecipient } from '../lib/engine/crypto'
import { classifyBoundary } from '../lib/engine/snapshot'
import { Journal } from '../lib/engine/journal'
import type { BackupSource, Entity, Snapshot } from '../lib/engine/types'

const identity = { clusterIncarnation: 'test-cluster', databaseOid: '100', serverMajor: 16, encoding: 'UTF8', collation: 'C' }
const evidence = { xmax: '100000000000', xipList: [] as string[] }
const entity = (key: string): Entity => ({ key, schema: 'public', table: key, columns: ['id','secret'], label: 'protected entity', estimatedRows: '2', estimatedBytes: '64', primaryKeys: ['id'] })
const catalogDigest = createHash('sha256').update('catalog').digest('hex')
function source(options: { fail?: string; xmax?: string; opened?: string[] } = {}): BackupSource {
  return {
    async open(): Promise<Snapshot> {
      return {
        identity, evidence: { ...evidence, xmax: options.xmax ?? evidence.xmax }, catalogDigest, entities: [entity('e0001'), entity('e0002')], foreignKeys: [],
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
  const options = () => ({ source: source(), output: join(root, 'out'), workspace: join(root, 'workspace'), recipients, reserveBytes: 0n })
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
  test('equal horizon with in-flight transactions is never proof of quiescence', () => {
    expect(classifyBoundary({identity,evidence:{...evidence,xipList:['99']}},{identity,evidence},'single-snapshot')).toBe('multi-snapshot')
    expect(classifyBoundary({identity,evidence},{identity,evidence},'multi-snapshot')).toBe('multi-snapshot')
  })
})
