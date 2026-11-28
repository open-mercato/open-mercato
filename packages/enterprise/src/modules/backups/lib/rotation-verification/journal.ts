import { constants } from 'node:fs'
import { open, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { RotationBatchCheckpoint } from '@open-mercato/shared/lib/encryption/rotationProtection'
import { keyedDigest, sameDigest } from './canonical'
import { RotationArtifactStore } from './store'

const checkpointSchema = z.object({ operationId: z.string().min(1).max(16384), cursor: z.array(z.string().max(8192)).min(1).max(64), readRows: z.number().int().min(1).max(500), writtenRows: z.number().int().nonnegative().max(500) }).strict().refine(value => value.writtenRows <= value.readRows)
const eventSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('batch'), checkpoint: checkpointSchema }).strict(),
  z.object({ kind: z.literal('phase'), status: z.enum(['rotating', 'verifying', 'passed', 'failed', 'interrupted']), code: z.string().regex(/^[A-Z_]+$/).max(128).optional() }).strict(),
])
type Event = z.infer<typeof eventSchema>
const tailSchema = z.object({ sequence: z.number().int().nonnegative().max(1000000), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const recordSchema = z.object({ version: z.literal(1), header: z.string().regex(/^[a-f0-9]{64}$/), sequence: z.number().int().nonnegative(), previous: z.string().regex(/^[a-f0-9]{64}$/), event: eventSchema, mac: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const invalid = () => new Error('[internal] ROTATION_JOURNAL_INVALID')

/** Encrypted, position-authenticated records; the committed tail lives outside artifact custody. */
export class RotationCheckpointJournal {
  private tail = { sequence: 0, hash: '0'.repeat(64) }
  private cursors = new Map<string, string[]>()
  private pending = Promise.resolve()
  private initialized = false
  constructor(private readonly store: RotationArtifactStore, private readonly path: string, private readonly header: string, private readonly key: Buffer, private readonly signal?: AbortSignal) {}
  private name(sequence: number) { return `journal-${String(sequence).padStart(12, '0')}` }
  private body(sequence: number, previous: string, event: Event) { return { version: 1 as const, header: this.header, sequence, previous, event } }
  async initialize(resume: boolean): Promise<void> {
    const interrupted = () => { if (this.signal?.aborted) throw new Error('[internal] ROTATION_VERIFICATION_INCOMPLETE') }
    interrupted()
    if (!resume) { await this.publishTail(); interrupted(); this.initialized = true; return }
    const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let tail: z.infer<typeof tailSchema>
    try {
      const info = await file.stat()
      if (!info.isFile() || info.size > 1024 || (info.mode & 0o077) || info.uid !== process.getuid?.()) throw invalid()
      tail = tailSchema.parse(JSON.parse(await file.readFile('utf8')))
    } finally { await file.close() }
    for (let sequence = 0; sequence < tail.sequence; sequence++) {
      interrupted()
      const record = recordSchema.parse(JSON.parse((await this.store.read(this.name(sequence))).toString()))
      interrupted()
      const { mac, ...body } = record
      if (record.header !== this.header || record.sequence !== sequence || record.previous !== this.tail.hash || !sameDigest(mac, keyedDigest(this.key, 'checkpoint-record-v1', JSON.stringify(body)))) throw invalid()
      this.apply(record.event)
      this.tail = { sequence: sequence + 1, hash: keyedDigest(this.key, 'checkpoint-tail-v1', JSON.stringify(record)) }
    }
    if (!sameDigest(tail.hash, this.tail.hash)) throw invalid()
    interrupted(); this.initialized = true
  }
  cursor(operationId: string): string[] | null { if (!this.initialized) throw invalid(); return this.cursors.get(operationId)?.slice() ?? null }
  private apply(event: Event) {
    if (event.kind === 'batch') {
      if (!this.cursors.has(event.checkpoint.operationId) && this.cursors.size >= 10000) throw invalid()
      this.cursors.set(event.checkpoint.operationId, event.checkpoint.cursor.slice())
    }
  }
  append(event: Event): Promise<void> {
    const operation = this.pending.then(async () => {
      if (!this.initialized) throw invalid()
      const parsed = eventSchema.parse(event)
      if (this.tail.sequence >= 1000000 || (parsed.kind === 'batch' && !this.cursors.has(parsed.checkpoint.operationId) && this.cursors.size >= 10000)) throw invalid()
      const body = this.body(this.tail.sequence, this.tail.hash, parsed)
      const record = { ...body, mac: keyedDigest(this.key, 'checkpoint-record-v1', JSON.stringify(body)) }
      // A crash before tail publication leaves an uncommitted record that is safely overwritten.
      await this.store.write(this.name(this.tail.sequence), Buffer.from(JSON.stringify(record)))
      this.tail = { sequence: this.tail.sequence + 1, hash: keyedDigest(this.key, 'checkpoint-tail-v1', JSON.stringify(record)) }
      await this.publishTail()
      this.apply(parsed)
    })
    this.pending = operation
    return operation
  }
  batch(checkpoint: RotationBatchCheckpoint): Promise<void> { return this.append({ kind: 'batch', checkpoint }) }
  private async publishTail(): Promise<void> {
    const temporary = `${this.path}.${randomUUID()}.partial`
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await file.writeFile(JSON.stringify(this.tail)); await file.sync() } finally { await file.close() }
    await rename(temporary, this.path)
    const directory = await open(dirname(this.path), constants.O_RDONLY)
    try { await directory.sync() } finally { await directory.close() }
  }
}
