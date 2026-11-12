import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { canonicalValue, keyedDigest, keyedRowDigest, keyFingerprint, rowIdentity, sameDigest, type VerificationRow } from './canonical'
import { RotationArtifactStore } from './store'

const headerSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string().uuid(), binding: z.string().length(64),
  rows: z.number().int().nonnegative(), fields: z.number().int().nonnegative(),
  chunks: z.number().int().nonnegative().max(1_000_000), root: z.string().regex(/^[0-9a-f]{64}$/),
  sourceFingerprint: z.string().length(64), targetFingerprint: z.string().length(64),
}).strict()
const expectedSchema = z.array(z.object({ identity: z.string().max(8192), digest: z.string().regex(/^[0-9a-f]{64}$/), fields: z.number().int().nonnegative(), metadata: z.string().regex(/^[0-9a-f]{64}$/) }).strict()).max(500)
export type VerificationBinding = { database: string; scope: string; schema: string; coverage: string; provider: string; backupDigest: string }
export interface RotationDataset {
  maintenanceBatchRows?: number
  assertFence(): Promise<void>
  binding(): Promise<VerificationBinding>
  rows(phase: 'before' | 'after', signal?: AbortSignal): AsyncIterable<VerificationRow>
  keys(): Promise<{ source: string; target: string; provider: string }>
}
export type PreparedRotation = { runId: string; trustedHeaderDigest: string }
export type VerificationResult = { schemaVersion: 1; runId: string; status: 'passed'; expectedRows: string; comparedRows: string; expectedFields: string; comparedFields: string; durationMs: number }

function digest(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex') }
function bindingDigest(binding: VerificationBinding): string {
  return digest(JSON.stringify([binding.database, binding.scope, binding.schema, binding.coverage, binding.provider, binding.backupDigest]))
}
function chunkName(index: number): string { return `chunk-${String(index).padStart(12, '0')}` }
function interrupted(signal?: AbortSignal): void { if (signal?.aborted) throw new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE') }

export async function prepareRotationVerification(dataset: RotationDataset, store: RotationArtifactStore, signal?: AbortSignal): Promise<PreparedRotation> {
  interrupted(signal)
  await dataset.assertFence()
  const bindingValue = await dataset.binding()
  const binding = bindingDigest(bindingValue)
  const keys = await dataset.keys()
  if (keys.provider !== bindingValue.provider) throw new Error('[internal] ROTATION_PROVIDER_CHANGED')
  const runKey = randomBytes(32)
  const sourceFingerprint = keyFingerprint(runKey, keys.source)
  const targetFingerprint = keyFingerprint(runKey, keys.target)
  if (sameDigest(sourceFingerprint, targetFingerprint)) throw new Error('[internal] ROTATION_UNCHANGED_KEY')
  const runId = randomUUID()
  await store.initialize()
  await store.write('run-key', runKey)
  let count = 0
  let fields = 0
  let chunks = 0
  let previousIdentity: string | null = null
  let records: z.infer<typeof expectedSchema> = []
  const root = createHash('sha256')
  const flush = async () => {
    if (!records.length) return
    if (chunks >= 1_000_000) throw new Error('[internal] ROTATION_ARTIFACT_LIMIT')
    const bytes = Buffer.from(JSON.stringify(records))
    root.update(keyedDigest(runKey, `chunk-${chunks}`, bytes))
    await store.write(chunkName(chunks++), bytes)
    records = []
  }
  try {
    for await (const row of dataset.rows('before', signal)) {
      interrupted(signal)
      const identity = rowIdentity(row)
      if (identity === previousIdentity) throw new Error('[internal] ROTATION_DUPLICATE_IDENTITY')
      previousIdentity = identity
      records.push({ identity, digest: keyedRowDigest(runKey, row), fields: row.columns.length, metadata: keyedDigest(runKey, 'metadata-v1', canonicalValue(row.metadata ?? {})) })
      count++; fields += row.columns.length
      if (records.length === 500) await flush()
    }
    await flush()
    await dataset.assertFence()
    if (!sameDigest(binding, bindingDigest(await dataset.binding()))) throw new Error('[internal] ROTATION_BINDING_CHANGED')
    const header = Buffer.from(JSON.stringify(headerSchema.parse({ schemaVersion: 1, runId, binding, rows: count, fields, chunks, root: root.digest('hex'), sourceFingerprint, targetFingerprint })))
    await store.write('header', header)
    await store.write('checkpoint', Buffer.from(JSON.stringify({ runId, status: 'prepared' })))
    return { runId, trustedHeaderDigest: digest(header) }
  } finally { runKey.fill(0) }
}

export async function verifyRotationData(prepared: PreparedRotation, dataset: RotationDataset, store: RotationArtifactStore, signal?: AbortSignal): Promise<VerificationResult> {
  const started = Date.now()
  interrupted(signal)
  const bytes = await store.read('header')
  if (!sameDigest(prepared.trustedHeaderDigest, digest(bytes))) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
  const header = headerSchema.parse(JSON.parse(bytes.toString()))
  if (header.runId !== prepared.runId) throw new Error('[internal] ROTATION_BINDING_CHANGED')
  const runKey = await store.read('run-key')
  if (runKey.length !== 32) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
  let iterator: AsyncIterator<VerificationRow> | undefined
  try {
    await dataset.assertFence()
    if (!sameDigest(header.binding, bindingDigest(await dataset.binding()))) throw new Error('[internal] ROTATION_BINDING_CHANGED')
    const keys = await dataset.keys()
    if (keys.provider !== (await dataset.binding()).provider) throw new Error('[internal] ROTATION_PROVIDER_CHANGED')
    if (!sameDigest(header.targetFingerprint, keyFingerprint(runKey, keys.target)) || !sameDigest(header.sourceFingerprint, keyFingerprint(runKey, keys.source))) throw new Error('[internal] ROTATION_KEY_CHANGED')
    await store.write('checkpoint', Buffer.from(JSON.stringify({ runId: header.runId, status: 'verifying' })))
    iterator = dataset.rows('after', signal)[Symbol.asyncIterator]()
    let rows = 0
    let fields = 0
    const root = createHash('sha256')
    for (let chunk = 0; chunk < header.chunks; chunk++) {
      interrupted(signal)
      const chunkBytes = await store.read(chunkName(chunk))
      root.update(keyedDigest(runKey, `chunk-${chunk}`, chunkBytes))
      for (const expected of expectedSchema.parse(JSON.parse(chunkBytes.toString()))) {
        interrupted(signal)
        const next = await iterator.next()
        if (next.done || rowIdentity(next.value) !== expected.identity || next.value.columns.length !== expected.fields || !sameDigest(expected.digest, keyedRowDigest(runKey, next.value))) throw new Error('[internal] ROTATION_DATA_MISMATCH')
        const metadata = keyedDigest(runKey, 'metadata-v1', canonicalValue(next.value.metadata ?? {}))
        if (!sameDigest(expected.metadata, metadata)) {
          const intent = next.value.metadataIntent
          if (!intent || !sameDigest(expected.metadata, keyedDigest(runKey, 'metadata-v1', canonicalValue(intent.before)))
            || !sameDigest(metadata, keyedDigest(runKey, 'metadata-v1', canonicalValue(intent.after)))
            || !sameDigest(intent.mac, keyedDigest(runKey, 'metadata-intent-v1', canonicalValue([expected.identity, intent.before, intent.after])))) {
            throw new Error('[internal] ROTATION_METADATA_MISMATCH')
          }
        }
        rows++; fields += expected.fields
      }
    }
    if (!(await iterator.next()).done || rows !== header.rows || fields !== header.fields || !sameDigest(root.digest('hex'), header.root)) throw new Error('[internal] ROTATION_DATA_MISMATCH')
    await dataset.assertFence()
    if (!sameDigest(header.binding, bindingDigest(await dataset.binding()))) throw new Error('[internal] ROTATION_BINDING_CHANGED')
    const result: VerificationResult = { schemaVersion: 1, runId: header.runId, status: 'passed', expectedRows: String(header.rows), comparedRows: String(rows), expectedFields: String(header.fields), comparedFields: String(fields), durationMs: Date.now() - started }
    await store.write('checkpoint', Buffer.from(JSON.stringify(result)))
    return result
  } catch (error) {
    await store.write('checkpoint', Buffer.from(JSON.stringify({ runId: header.runId, status: signal?.aborted ? 'interrupted' : 'failed' })))
    throw error
  } finally {
    try { await iterator?.return?.() } finally { runKey.fill(0) }
  }
}

export async function validatePreparedRotation(prepared: PreparedRotation, dataset: RotationDataset, store: RotationArtifactStore, signal?: AbortSignal): Promise<Buffer> {
  interrupted(signal)
  const bytes = await store.read('header')
  if (!sameDigest(prepared.trustedHeaderDigest, digest(bytes))) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
  const header = headerSchema.parse(JSON.parse(bytes.toString()))
  if (header.runId !== prepared.runId) throw new Error('[internal] ROTATION_BINDING_CHANGED')
  const runKey = await store.read('run-key')
  try {
    if (runKey.length !== 32) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    await dataset.assertFence()
    const binding = await dataset.binding()
    const keys = await dataset.keys()
    if (!sameDigest(header.binding, bindingDigest(binding)) || keys.provider !== binding.provider) throw new Error('[internal] ROTATION_BINDING_CHANGED')
    if (!sameDigest(header.sourceFingerprint, keyFingerprint(runKey, keys.source)) || !sameDigest(header.targetFingerprint, keyFingerprint(runKey, keys.target))) throw new Error('[internal] ROTATION_KEY_CHANGED')
    const root = createHash('sha256')
    let rows = 0; let fields = 0
    for (let chunk = 0; chunk < header.chunks; chunk++) {
      interrupted(signal)
      const chunkBytes = await store.read(chunkName(chunk))
      root.update(keyedDigest(runKey, `chunk-${chunk}`, chunkBytes))
      for (const expected of expectedSchema.parse(JSON.parse(chunkBytes.toString()))) { rows++; fields += expected.fields }
    }
    if (rows !== header.rows || fields !== header.fields || !sameDigest(root.digest('hex'), header.root)) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    return runKey
  } catch (error) { runKey.fill(0); throw error }
}
