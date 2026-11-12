import { constants } from 'node:fs'
import { open, readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { encryptBytes, decryptBytes } from './crypto'
import { privateFile } from './artifacts'
import { BackupError } from './errors'

const recordSchema = z.object({ sequence: z.number().int().nonnegative(), previous: z.string().regex(/^[a-f0-9]{64}$/), payload: z.string().max(12 * 1024 * 1024), hash: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
export class Journal {
  private previous = '0'.repeat(64)
  private sequence = 0
  constructor(private readonly path: string, private readonly recipient: string, private readonly identity: string) {}
  async append(value: unknown): Promise<void> {
    const plaintext = Buffer.from(JSON.stringify(value))
    if (plaintext.length > 8 * 1024 * 1024) throw new BackupError('BACKUP_JOURNAL_RECORD_LIMIT', 3)
    const payload = (await encryptBytes(plaintext, [this.recipient])).toString('base64')
    const content = { sequence: this.sequence, previous: this.previous, payload }
    const record = { ...content, hash: hash(JSON.stringify(content)) }
    const file = await open(this.path, constants.O_CREAT | constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await file.writeFile(JSON.stringify(record) + '\n'); await file.sync() } finally { await file.close() }
    this.previous = record.hash
    this.sequence++
  }
  async *entries(): AsyncIterable<unknown> {
    await privateFile(this.path)
    const file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW)
    let count = 0
    const size = (await file.stat()).size
    const tail = Buffer.alloc(1)
    if (size) await file.read(tail, 0, 1, size - 1)
    const terminated = !size || tail[0] === 10
    let validBytes = 0
    try {
      for await (const line of file.readLines()) {
        if (!terminated && validBytes + Buffer.byteLength(line) === size) {
          const writer = await open(this.path, constants.O_WRONLY | constants.O_NOFOLLOW)
          try { await writer.truncate(validBytes); await writer.sync() } finally { await writer.close() }
          break
        }
        if (line.length > 16 * 1024 * 1024) throw new BackupError('BACKUP_JOURNAL_LIMIT', 4)
        let parsed: z.infer<typeof recordSchema>
        try { parsed = recordSchema.parse(JSON.parse(line)) }
        catch { throw new BackupError('BACKUP_JOURNAL_INTEGRITY', 4) }
        const { hash: expected, ...content } = parsed
        if (content.sequence !== this.sequence || content.previous !== this.previous || hash(JSON.stringify(content)) !== expected) throw new BackupError('BACKUP_JOURNAL_INTEGRITY', 4)
        const value: unknown = JSON.parse((await decryptBytes(Buffer.from(content.payload, 'base64'), [this.identity], 8 * 1024 * 1024)).toString())
        count++
        if (count > 1000000) throw new BackupError('BACKUP_JOURNAL_LIMIT', 4)
        this.previous = expected
        this.sequence++
        validBytes += Buffer.byteLength(line) + 1
        yield value
      }
    } finally { await file.close().catch(() => undefined) }
  }
  async read(): Promise<unknown[]> {
    const values: unknown[] = []
    for await (const value of this.entries()) values.push(value)
    return values
  }
}
