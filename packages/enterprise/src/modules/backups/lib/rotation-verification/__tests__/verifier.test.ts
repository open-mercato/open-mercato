import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { encryptWithAesGcm, decryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { canonicalValue, canonicalRow, keyFingerprint, keyedDigest, keyedRowDigest, keyedRowDigestAndSize, rowIdentity, type VerificationRow } from '../canonical'
import { RotationArtifactStore } from '../store'
import { prepareRotationVerification, verifyRotationData, readVerificationFailureAggregates, validatePreparedRotation, type RotationDataset } from '../verifier'

const source = randomBytes(32).toString('base64')
const target = randomBytes(32).toString('base64')
const artifactKey = randomBytes(32).toString('base64')
const row = (index: number): VerificationRow => ({
  entity: 'test:records', tenantId: 'tenant', organizationId: null, identity: [String(index)],
  columns: [{ name: 'secret', type: 'text', value: `private-value-${index}` }, { name: 'decimal', type: 'numeric', value: '9007199254740993.1234' }],
})

let directory: string
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'rotation-verification-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })
function fixture(count = 1001) {
  const state = { count, corruption: -1, extra: false, provider: 'vault', changedKey: false, fence: true, scope: 'scope', abortAt: -1 }
  const dataset: RotationDataset = {
    assertFence: async () => { if (!state.fence) throw new Error('fence lost') },
    binding: async () => ({ database: 'cluster/database', scope: state.scope, schema: 'schema', coverage: 'complete', provider: state.provider, backupDigest: 'a'.repeat(64) }),
    keys: async () => ({ source, target: state.changedKey ? source : target, provider: state.provider }),
    async *rows(phase, signal) {
      for (let index = 0; index < state.count; index++) {
        if (phase === 'after' && index === state.abortAt) signal?.throwIfAborted()
        const value = row(index)
        if (phase === 'after' && index === state.corruption) value.columns[0]!.value = 'incorrect-but-validly-encrypted'
        yield value
      }
      if (phase === 'after' && state.extra) yield row(state.count)
    },
  }
  const store = new RotationArtifactStore(join(directory, 'artifacts'), {
    async seal(bytes) { return Buffer.from(encryptWithAesGcm(Buffer.from(bytes).toString('base64'), artifactKey).raw) },
    async open(bytes) {
      const plaintext = decryptWithAesGcm(Buffer.from(bytes).toString(), artifactKey)
      if (plaintext === null) throw new Error('authentication failure')
      return Buffer.from(plaintext, 'base64')
    },
  })
  return { state, dataset, store }
}

test('streams a full multi-chunk roundtrip and writes no plaintext baseline to disk', async () => {
  const { dataset, store } = fixture()
  const prepared = await prepareRotationVerification(dataset, store)
  const result = await verifyRotationData(prepared, dataset, store)
  expect(result).toMatchObject({ status: 'passed', expectedRows: '1001', comparedRows: '1001', expectedFields: '2002', comparedFields: '2002' })
  for (const name of await readdir(join(directory, 'artifacts'))) {
    expect((await readFile(join(directory, 'artifacts', name))).toString()).not.toContain('private-value')
  }
})

test('baseline chunks and root exactly match the original synchronous row protocol', async () => {
  const { dataset, store } = fixture()
  await prepareRotationVerification(dataset, store)
  const runKey = await store.read('run-key')
  try {
    const root = createHash('sha256')
    let totalBytes = 0n
    for (let chunk = 0; chunk < 3; chunk++) {
      const expected = []
      for (let index = chunk * 500; index < Math.min(1001, (chunk + 1) * 500); index++) {
        const value = row(index), old = keyedRowDigestAndSize(runKey, value)
        totalBytes += BigInt(old.bytes)
        expected.push({ identity: rowIdentity(value), digest: old.digest, bytes: old.bytes, fields: value.columns.length, metadata: keyedDigest(runKey, 'metadata-v1', canonicalValue({})) })
      }
      const bytes = Buffer.from(JSON.stringify(expected))
      expect(await store.read(`chunk-${String(chunk).padStart(12, '0')}`)).toEqual(bytes)
      root.update(keyedDigest(runKey, `chunk-${chunk}`, bytes))
    }
    expect(JSON.parse((await store.read('header')).toString())).toMatchObject({ root: root.digest('hex'), bytes: String(totalBytes), rows: 1001, fields: 2002, chunks: 3 })
  } finally { runKey.fill(0) }
})

test('absent metadata retains the empty-object MAC while nonempty changes require a run-bound intent', async () => {
  const { dataset, store } = fixture(1)
  let afterMetadata: VerificationRow['metadata'] = {}
  let intent: VerificationRow['metadataIntent']
  dataset.rows = async function* (phase) {
    yield { ...row(0), ...(phase === 'after' ? { metadata: afterMetadata, metadataIntent: intent } : {}) }
  }
  const prepared = await prepareRotationVerification(dataset, store)
  const runKey = await store.read('run-key')
  try {
    const [expected] = JSON.parse((await store.read('chunk-000000000000')).toString())
    expect(expected.metadata).toBe(keyedDigest(runKey, 'metadata-v1', canonicalValue({})))
    // Explicit empty metadata remains equivalent to the original absent value.
    await expect(verifyRotationData(prepared, dataset, store)).resolves.toMatchObject({ status: 'passed' })
    afterMetadata = { updated_at: '2026-11-12T00:00:00.123456Z' }
    await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_METADATA_MISMATCH')
    intent = { before: {}, after: afterMetadata, mac: keyedDigest(runKey, 'metadata-intent-v1', canonicalValue([expected.identity, {}, afterMetadata])) }
    await expect(verifyRotationData(prepared, dataset, store)).resolves.toMatchObject({ status: 'passed' })
    // A different run key cannot authorize even the same public transition.
    intent.mac = keyedDigest(Buffer.alloc(32), 'metadata-intent-v1', canonicalValue([expected.identity, {}, afterMetadata]))
    await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_METADATA_MISMATCH')
  } finally { runKey.fill(0) }
})

test.each([0, 500, 1000])('rejects valid-but-wrong logical data at row %s', async (corruption) => {
  const { state, dataset, store } = fixture()
  const prepared = await prepareRotationVerification(dataset, store)
  state.corruption = corruption
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_DATA_MISMATCH')
  expect(JSON.parse((await store.read('checkpoint')).toString()).payload.status).toBe('failed')
})

test('rejects missing final row rather than accepting a verified prefix', async () => {
  const { state, dataset, store } = fixture()
  const prepared = await prepareRotationVerification(dataset, store)
  state.count--
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_DATA_MISMATCH')
})

test('rejects extra rows', async () => {
  const { state, dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  state.extra = true
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_DATA_MISMATCH')
})

test('refuses same actual source/target key before creating artifacts', async () => {
  const { state, dataset, store } = fixture(2)
  state.changedKey = true
  await expect(prepareRotationVerification(dataset, store)).rejects.toThrow('ROTATION_UNCHANGED_KEY')
  expect(await readdir(directory)).toEqual([])
})

test.each(['scope', 'provider'])('rejects changed %s binding', async (name) => {
  const { state, dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  state[name as 'scope' | 'provider'] = 'changed'
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_BINDING_CHANGED')
})

test('rejects changed concrete key even with the same provider', async () => {
  const { state, dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  state.changedKey = true
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_KEY_CHANGED')
})

test('refuses lost fence', async () => {
  const { state, dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  state.fence = false
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('fence lost')
})

test('trusted root rejects rewritten header', async () => {
  const { dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  const header = JSON.parse((await store.read('header')).toString())
  await store.write('header', Buffer.from(JSON.stringify({ ...header, rows: 0 })))
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_ARTIFACT_INVALID')
})

test('edited encrypted chunk cannot replace original logical expectations', async () => {
  const { dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  await store.write('chunk-000000000000', Buffer.from('[]'))
  await expect(verifyRotationData(prepared, dataset, store)).rejects.toThrow('ROTATION_DATA_MISMATCH')
})

test('aborted final scan never writes passed and can be verified afresh', async () => {
  const { dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  const controller = new AbortController()
  controller.abort()
  await expect(verifyRotationData(prepared, dataset, store, controller.signal)).rejects.toThrow('ROTATION_VERIFICATION_INCOMPLETE')
  await expect(verifyRotationData(prepared, dataset, store)).resolves.toMatchObject({ comparedRows: '2' })
})

test('typed canonical encoding preserves object ordering but distinguishes values and SQL types', () => {
  expect(canonicalValue({ z: 'x', a: null })).toEqual(canonicalValue({ a: null, z: 'x' }))
  expect(canonicalValue(['1', null])).not.toEqual(canonicalValue([1, 'null']))
  const before = row(1)
  const after = row(1); after.columns[1]!.type = 'text'
  expect(canonicalRow(before)).not.toEqual(canonicalRow(after))
  expect(() => canonicalValue(9007199254740992)).toThrow('ROTATION_COVERAGE_UNSUPPORTED')
  const runKey = randomBytes(32)
  expect(keyFingerprint(runKey, source)).toBe(keyFingerprint(runKey, source))
  expect(keyFingerprint(runKey, source)).not.toBe(keyFingerprint(runKey, target))
})


test('streamed row HMAC exactly matches framed golden bytes without whole-row buffer copies', () => {
  const key = randomBytes(32)
  for (const value of [null, true, false, '日本語', -0, 1.5, ['x', null, { b: 2, a: 'hello' }], { unicode: '😀', binary: 'AA==' }]) {
    const candidate = row(4); candidate.columns[0]!.value = value
    expect(keyedRowDigest(key, candidate)).toBe(keyedDigest(key, 'row-v1', canonicalRow(candidate)))
  }
})


test('a validly re-encrypted but replaced run key refuses before any resumed operation', async () => {
  const { dataset, store } = fixture(2)
  const prepared = await prepareRotationVerification(dataset, store)
  await store.write('run-key', randomBytes(32))
  const operation = jest.fn()
  await expect(validatePreparedRotation(prepared, dataset, store).then(operation)).rejects.toThrow('ROTATION_KEY_CHANGED')
  expect(operation).not.toHaveBeenCalled()
})
test('resume authenticates every baseline chunk before further writes', async () => {
  const { dataset, store } = fixture(1001)
  const prepared = await prepareRotationVerification(dataset, store)
  await store.write('chunk-000000000002', Buffer.from('[]'))
  const operation = jest.fn()
  await expect(validatePreparedRotation(prepared, dataset, store).then(operation)).rejects.toThrow('ROTATION_ARTIFACT_INVALID')
  expect(operation).not.toHaveBeenCalled()
})


test('failed-attempt aggregates are authenticated and cannot replay a previous attempt or forged counts', async () => {
  const { state, dataset, store } = fixture(10); const prepared = await prepareRotationVerification(dataset, store)
  state.corruption = 3; const attempt = randomUUID(); const key = await store.read('run-key')
  try {
    await expect(verifyRotationData(prepared, dataset, store, undefined, attempt)).rejects.toThrow('DATA_MISMATCH')
    await expect(readVerificationFailureAggregates(prepared, store, key, attempt)).resolves.toMatchObject({ expectedRows: '10', comparedRows: '3', expectedFields: '20', comparedFields: '6' })
    await expect(readVerificationFailureAggregates(prepared, store, key, randomUUID())).rejects.toThrow('ARTIFACT_INVALID')
    const forged = JSON.parse((await store.read('checkpoint')).toString()); forged.payload.comparedRows = '10'
    await store.write('checkpoint', Buffer.from(JSON.stringify(forged)))
    await expect(readVerificationFailureAggregates(prepared, store, key, attempt)).rejects.toThrow('ARTIFACT_INVALID')
  } finally { key.fill(0) }
})
