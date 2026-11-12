import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { RotationArtifactStore } from '../store'
import { RotationCheckpointJournal } from '../journal'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rotation-journal-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
async function fixture() {
  const encryptionKey = randomBytes(32).toString('base64')
  const cipher = {
    async seal(bytes: Uint8Array) { return Buffer.from(encryptWithAesGcm(Buffer.from(bytes).toString('base64'), encryptionKey).raw) },
    async open(bytes: Uint8Array) { const value = decryptWithAesGcm(Buffer.from(bytes).toString(), encryptionKey); if (value === null) throw new Error('ciphertext invalid'); return Buffer.from(value, 'base64') },
  }
  const directory = join(root, 'artifacts'); const store = new RotationArtifactStore(directory, cipher); await store.initialize()
  const tail = join(root, 'trusted.tail'); const key = randomBytes(32); const header = 'a'.repeat(64)
  const make = () => new RotationCheckpointJournal(store, tail, header, key)
  const journal = make(); await journal.initialize(false)
  return { store, tail, key, header, directory, make, journal }
}
const checkpoint = { operationId: 'mapped-scope-1', cursor: ['9007199254740993', 'private-row-id'], readRows: 2, writtenRows: 1 }

test('restores exact committed cursor from encrypted records and keeps identifiers out of trust record', async () => {
  const f = await fixture()
  await f.journal.batch(checkpoint)
  await f.journal.append({ kind: 'phase', status: 'verifying' })
  const resumed = f.make(); await resumed.initialize(true)
  expect(resumed.cursor(checkpoint.operationId)).toEqual(checkpoint.cursor)
  expect(await readFile(f.tail, 'utf8')).not.toContain('private-row-id')
  for (const name of await readdir(f.directory)) expect(await readFile(join(f.directory, name), 'utf8')).not.toContain('private-row-id')
})

test('refuses truncation of committed records and forged encryption by a recipient without the run key', async () => {
  const f = await fixture(); await f.journal.batch(checkpoint)
  const record = JSON.parse((await f.store.read('journal-000000000000')).toString())
  record.event.checkpoint.cursor = ['attacker']; await f.store.write('journal-000000000000', Buffer.from(JSON.stringify(record)))
  await expect(f.make().initialize(true)).rejects.toThrow('JOURNAL_INVALID')
  await rm(join(f.directory, 'journal-000000000000.age'))
  await expect(f.make().initialize(true)).rejects.toThrow()
})

test('refuses record replay/reordering, header substitution and tail truncation', async () => {
  const f = await fixture(); await f.journal.batch(checkpoint); await f.journal.append({ kind: 'phase', status: 'verifying' })
  const first = await f.store.read('journal-000000000000'); const second = await f.store.read('journal-000000000001')
  await f.store.write('journal-000000000001', first)
  await expect(f.make().initialize(true)).rejects.toThrow('JOURNAL_INVALID')
  await f.store.write('journal-000000000001', second)
  await expect(new RotationCheckpointJournal(f.store, f.tail, 'b'.repeat(64), f.key).initialize(true)).rejects.toThrow('JOURNAL_INVALID')
  await writeFile(f.tail, JSON.stringify({ sequence: 2, hash: '0'.repeat(64) }))
  await expect(f.make().initialize(true)).rejects.toThrow('JOURNAL_INVALID')
})

test('ignores an unanchored crash record and overwrites it before publishing a new committed tail', async () => {
  const f = await fixture(); await f.journal.batch(checkpoint)
  const anchored = await readFile(f.tail)
  await f.journal.batch({ ...checkpoint, cursor: ['uncommitted'] })
  await writeFile(f.tail, anchored)
  const resumed = f.make(); await resumed.initialize(true)
  expect(resumed.cursor(checkpoint.operationId)).toEqual(checkpoint.cursor)
  await resumed.batch({ ...checkpoint, cursor: ['committed-after-restart'] })
  const again = f.make(); await again.initialize(true)
  expect(again.cursor(checkpoint.operationId)).toEqual(['committed-after-restart'])
})

test('rejects an impossible commit before advancing the trusted tail', async () => {
  const f = await fixture(); const before = await readFile(f.tail, 'utf8')
  await expect(f.journal.batch({ ...checkpoint, readRows: 1, writtenRows: 2 })).rejects.toThrow()
  expect(await readFile(f.tail, 'utf8')).toBe(before)
  const resumed = f.make(); await resumed.initialize(true)
  expect(resumed.cursor(checkpoint.operationId)).toBeNull()
})
