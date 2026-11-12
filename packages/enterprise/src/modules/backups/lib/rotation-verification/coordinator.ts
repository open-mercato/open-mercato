import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, mkdir, open, rename, realpath, unlink } from 'node:fs/promises'
import { hostname } from 'node:os'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { z } from 'zod'
import type { RotationProtectionContext, RotationProtectionService, RotationKeyProviders, RotationTimestampIntent } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { canonicalValue, keyedDigest, sameDigest, type LogicalValue } from './canonical'
import type { PinnedRotationProviders } from './keys'
import { canonicalRotationTimestamp } from './postgres-dataset'
import { RotationArtifactStore, type RotationArtifactCipher } from './store'
import { prepareRotationVerification, verifyRotationData, type PreparedRotation, type RotationDataset, type VerificationResult } from './verifier'

export type RecoveryArtifact = { artifactPath: string; digest: string; databaseBinding: string; consistency: 'quiesced'; encrypted: true }
export type TimestampRecord = { before: Record<string, LogicalValue>; after: Record<string, LogicalValue>; mac: string }
export type TimestampLoader = { load(identity: string): Promise<TimestampRecord | undefined> }
export type RotationCoordinatorOptions = {
  artifactRoot: string
  trustRoot: string
  resumeId?: string
  signal?: AbortSignal
  assertEntitlement(): Promise<void>
  providers(context: RotationProtectionContext): Promise<PinnedRotationProviders>
  dataset(context: RotationProtectionContext, providers: RotationKeyProviders, backupDigest: string, intents: TimestampLoader): Promise<RotationDataset>
  recovery: {
    create(context: RotationProtectionContext, databaseBinding: string): Promise<RecoveryArtifact>
    verify(artifact: RecoveryArtifact, context: RotationProtectionContext): Promise<void>
  }
  cipher(): Promise<RotationArtifactCipher>
  reportRun?(id: string): Promise<void>
  report(result: VerificationResult, recovery: RecoveryArtifact): Promise<void>
}

const recoverySchema = z.object({ artifactPath: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/), databaseBinding: z.string(), consistency: z.literal('quiesced'), encrypted: z.literal(true) }).strict()
const stateSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().uuid(), prepared: z.object({ runId: z.string().uuid(), trustedHeaderDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  recovery: recoverySchema, status: z.enum(['prepared', 'rotating', 'verifying', 'passed', 'failed', 'interrupted']),
}).strict()
type State = z.infer<typeof stateSchema>
const timestampSchema = z.object({ before: z.record(z.string(), z.union([z.string(), z.null()])), after: z.record(z.string(), z.union([z.string(), z.null()])), mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const hash = (text: string) => createHash('sha256').update(text).digest('hex')

async function ownerDirectory(path: string) {
  if (!isAbsolute(path)) throw new Error('[internal] ROTATION_ABSOLUTE_PATH_REQUIRED')
  await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
}

async function publishState(path: string, state: State) {
  const temporary = `${path}.${randomUUID()}.partial`
  const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  try { await file.writeFile(JSON.stringify(stateSchema.parse(state))); await file.sync() } finally { await file.close() }
  await rename(temporary, path)
  const directory = await open(dirname(path), constants.O_RDONLY)
  try { await directory.sync() } finally { await directory.close() }
}

async function loadState(path: string): Promise<State> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 8 * 1024 * 1024 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
    return stateSchema.parse(JSON.parse(await file.readFile('utf8')))
  } finally { await file.close() }
}

async function acquireLock(path: string, id: string, resume: boolean) {
  const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW
  try { return await open(path, flags, 0o600) }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || !resume) throw error }
  const recoveryPath = `${path}.recovery`
  const recovery = await open(recoveryPath, flags, 0o600)
  try {
    const prior = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      const info = await prior.stat()
      if (!info.isFile() || info.size > 2048 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.()) throw new Error('[internal] ROTATION_RUN_LOCKED')
      const record = z.object({ pid: z.number().int().positive(), host: z.string(), id: z.string().uuid(), startedAt: z.string() }).parse(JSON.parse(await prior.readFile('utf8')))
      if (record.id !== id || record.host !== hostname() || Date.now() - Date.parse(record.startedAt) <= 60000 || !Number.isFinite(Date.parse(record.startedAt))) throw new Error('[internal] ROTATION_RUN_LOCKED')
      let dead = false
      try { process.kill(record.pid, 0) } catch (error) { dead = (error as NodeJS.ErrnoException).code === 'ESRCH' }
      if (!dead || (await lstat(path)).ino !== info.ino) throw new Error('[internal] ROTATION_RUN_LOCKED')
      await unlink(path)
    } finally { await prior.close() }
    return await open(path, flags, 0o600)
  } finally { await recovery.close(); await unlink(recoveryPath) }
}

export function createEnterpriseRotationProtection(options: RotationCoordinatorOptions): RotationProtectionService {
  return {
    async protect(context, operation) {
      if (context.dryRun) throw new Error('[internal] ROTATION_MUTATING_COORDINATOR_IN_DRY_RUN')
      if (!context.previousKey) throw new Error('[internal] ROTATION_SOURCE_KEY_REQUIRED')
      options.signal?.throwIfAborted()
      await options.assertEntitlement()
      await ownerDirectory(options.artifactRoot); await ownerDirectory(options.trustRoot)
      const artifactRoot = await realpath(options.artifactRoot); const trustRoot = await realpath(options.trustRoot)
      const nested = relative(artifactRoot, trustRoot)
      const inverse = relative(trustRoot, artifactRoot)
      if (!nested || !nested.startsWith('..') || !inverse || !inverse.startsWith('..')) throw new Error('[internal] ROTATION_TRUST_ANCHOR_LOCATION')
      const id = options.resumeId ?? randomUUID()
      if (!z.string().uuid().safeParse(id).success) throw new Error('[internal] ROTATION_RESUME_INVALID')
      const trustPath = join(trustRoot, `${id}.json`)
      const anchors = join(trustRoot, `${id}-intents`)
      await ownerDirectory(anchors)
      const lockPath = join(trustRoot, 'rotation.lock')
      const lock = await acquireLock(lockPath, id, Boolean(options.resumeId))
      let state: State | undefined
      let runKey: Buffer | undefined
      try {
        const store = new RotationArtifactStore(join(artifactRoot, id), await options.cipher())
        await lock.writeFile(JSON.stringify({ pid: process.pid, host: hostname(), id, startedAt: new Date().toISOString() })); await lock.sync()
        await options.reportRun?.(id)
        const providers = await options.providers(context)
        let intentQueue = Promise.resolve()
        const intents: TimestampLoader = {
          async load(identity) {
            const name = `intent-${hash(identity)}`
            if (!runKey) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
            let bytes: Buffer
            try { bytes = await store.read(name) }
            catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error }
            const anchor = await open(join(anchors, name), constants.O_RDONLY | constants.O_NOFOLLOW)
            try {
              const info = await anchor.stat()
              if (!info.isFile() || info.size !== 64 || (info.mode & 0o077) !== 0 || info.uid !== process.getuid?.() || !sameDigest(await anchor.readFile('utf8'), keyedDigest(runKey, 'intent-anchor-v1', bytes))) throw new Error('[internal] ROTATION_METADATA_MISMATCH')
            } finally { await anchor.close() }
            const intent = timestampSchema.parse(JSON.parse(bytes.toString()))
            if (!sameDigest(intent.mac, keyedDigest(runKey, 'metadata-intent-v1', canonicalValue([identity, intent.before, intent.after])))) throw new Error('[internal] ROTATION_METADATA_MISMATCH')
            return intent
          },
        }
        const initial = await options.dataset(context, providers, '0'.repeat(64), intents)
        await initial.assertFence()
        const databaseBinding = (await initial.binding()).database
        if (options.resumeId) {
          state = await loadState(trustPath)
          if (state.id !== id || state.recovery.databaseBinding !== databaseBinding || state.status === 'passed') throw new Error('[internal] ROTATION_RESUME_INVALID')
          await options.recovery.verify(state.recovery, context)
        } else {
          const recovery = recoverySchema.parse(await options.recovery.create(context, databaseBinding))
          if (recovery.databaseBinding !== databaseBinding) throw new Error('[internal] ROTATION_BACKUP_DATABASE_MISMATCH')
          await options.recovery.verify(recovery, context)
          await initial.assertFence(); await providers.refresh()
          const dataset = await options.dataset(context, providers, recovery.digest, intents)
          const prepared = await prepareRotationVerification(dataset, store, options.signal)
          state = { schemaVersion: 1, id, prepared, recovery, status: 'prepared' }
          await publishState(trustPath, state)
        }
        runKey = await store.read('run-key')
        if (runKey.length !== 32) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
        const dataset = await options.dataset(context, providers, state.recovery.digest, intents)
        await dataset.assertFence(); await providers.refresh()
        state.status = 'rotating'; await publishState(trustPath, state)
        providers.timestampForWrite = async (intent: RotationTimestampIntent) => {
          let chosen: Date | undefined
          const pending = intentQueue.then(async () => {
            if (!state || !runKey) throw new Error('[internal] ROTATION_ARTIFACT_INVALID')
            const entity = intent.table.includes('.') ? intent.table : `public.${intent.table}`
            if (entity !== 'public.custom_entities_storage') throw new Error('[internal] ROTATION_TIMESTAMP_SCOPE_UNSUPPORTED')
            const identity = JSON.stringify([entity, intent.tenantId, intent.organizationId, [intent.identity]])
            const existing = await intents.load(identity)
            const before = { updated_at: canonicalRotationTimestamp(intent.previousTimestamp) }
            if (existing) {
              if (JSON.stringify(existing.before) !== JSON.stringify(before)) throw new Error('[internal] ROTATION_METADATA_MISMATCH')
              chosen = new Date(String(existing.after.updated_at)); return
            }
            chosen = new Date()
            const after = { updated_at: canonicalRotationTimestamp(chosen) }
            const record: TimestampRecord = { before, after, mac: keyedDigest(runKey, 'metadata-intent-v1', canonicalValue([identity, before, after])) }
            const bytes = Buffer.from(JSON.stringify(record)); const name = `intent-${hash(identity)}`
            await store.write(name, bytes)
            const anchor = await open(join(anchors, name), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
            try { await anchor.writeFile(keyedDigest(runKey, 'intent-anchor-v1', bytes)); await anchor.sync() } finally { await anchor.close() }
            const parent = await open(anchors, constants.O_RDONLY)
            try { await parent.sync() } finally { await parent.close() }
          })
          intentQueue = pending
          await pending
          return chosen!
        }
        await operation(providers)
        await intentQueue
        await options.assertEntitlement(); await dataset.assertFence(); await providers.refresh()
        state.status = 'verifying'; await publishState(trustPath, state)
        const result = await verifyRotationData(state.prepared as PreparedRotation, dataset, store, options.signal)
        await options.report(result, state.recovery)
        state.status = 'passed'; await publishState(trustPath, state)
      } catch (error) {
        if (state) {
          state.status = options.signal?.aborted ? 'interrupted' : 'failed'
          await publishState(trustPath, state)
        }
        throw error
      } finally {
        runKey?.fill(0)
        await lock.close()
        await unlink(lockPath)
      }
    },
  }
}
