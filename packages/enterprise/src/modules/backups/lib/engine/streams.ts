import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ByteStream } from './types'
import { BackupError, checkAbort } from './errors'

export function webStream(source: ByteStream): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]()
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value)
      } catch (error) { controller.error(error) }
    },
    async cancel() { await iterator.return?.() },
  })
}
export async function* nodeStream(source: ReadableStream<Uint8Array>): ByteStream {
  const reader = source.getReader()
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      yield next.value
    }
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock() }
}
export async function* transform(source: ByteStream, transformer: Transform): ByteStream {
  const input = Readable.from(source, { objectMode: false, highWaterMark: 256 * 1024 })
  const completion = pipeline(input, transformer)
  void completion.catch(() => undefined)
  try {
    for await (const chunk of transformer) yield chunk as Uint8Array
    await completion
  } finally {
    input.destroy()
    transformer.destroy()
    await completion.catch(() => undefined)
  }
}
export async function collect(source: ByteStream, maximum: number, signal?: AbortSignal): Promise<Buffer> {
  const parts: Buffer[] = []
  let size = 0
  for await (const chunk of source) {
    checkAbort(signal)
    size += chunk.byteLength
    if (size > maximum) throw new BackupError('BACKUP_RESOURCE_LIMIT', 3)
    parts.push(Buffer.from(chunk))
  }
  return Buffer.concat(parts)
}
export async function* bytes(value: Uint8Array): ByteStream { yield value }
