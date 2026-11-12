import { Encrypter, Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption'
import { createReadStream } from 'node:fs'
import { readFile, open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ByteStream } from './types'
import { nodeStream, webStream, bytes, collect } from './streams'
import { BackupError } from './errors'
import { atomicStream, privateFile, readBoundedFile } from './artifacts'

export { generateX25519Identity, identityToRecipient }
export async function recipientsFromFile(path: string): Promise<string[]> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  let text: string
  try {
    const info = await handle.stat()
    if (!info.isFile() || (info.mode & 0o022) || (process.getuid && info.uid !== process.getuid())) throw new BackupError('BACKUP_INVALID_RECIPIENTS_FILE', 3)
    text = (await collect(handle.createReadStream({ autoClose: false }), 65536)).toString()
  } finally { await handle.close() }
  const recipients = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (recipients.length < 1 || recipients.length > 10 || recipients.some((value) => !/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(value))) {
    throw new BackupError('BACKUP_INVALID_RECIPIENTS', 2)
  }
  for (const recipient of recipients) { const encrypter = new Encrypter(); encrypter.addRecipient(recipient) }
  return [...new Set(recipients)].sort()
}
export async function identitiesFromFile(path: string): Promise<string[]> {
  await privateFile(path)
  const identities = (await readBoundedFile(path, 65536)).toString().split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#'))
  if (!identities.length || identities.length > 10) throw new BackupError('BACKUP_INVALID_IDENTITY', 3)
  return identities
}
export function recipientFingerprint(recipients: string[]): string {
  return createHash('sha256').update(JSON.stringify([...recipients].sort())).digest('hex')
}
export async function encryptStream(source: ByteStream, recipients: string[]): Promise<ByteStream> {
  const encrypter = new Encrypter()
  for (const recipient of recipients) encrypter.addRecipient(recipient)
  return nodeStream(await encrypter.encrypt(webStream(source)))
}
export async function decryptStream(source: ByteStream, identities: string[]): Promise<ByteStream> {
  const decrypter = new Decrypter()
  for (const identity of identities) decrypter.addIdentity(identity)
  try { return nodeStream(await decrypter.decrypt(webStream(source))) }
  catch { throw new BackupError('BACKUP_AUTHENTICATION_FAILED', 4) }
}
export async function encryptBytes(value: Uint8Array, recipients: string[]): Promise<Buffer> {
  return collect(await encryptStream(bytes(value), recipients), value.byteLength + 65536)
}
export async function decryptBytes(value: Uint8Array, identities: string[], maximum = 64 * 1024 * 1024): Promise<Buffer> {
  try { return await collect(await decryptStream(bytes(value), identities), maximum) }
  catch (error) { if (error instanceof BackupError) throw error; throw new BackupError('BACKUP_AUTHENTICATION_FAILED', 4) }
}
export async function encryptFile(options: { sourcePath: string; destinationPath: string; recipients: string[]; signal?: AbortSignal }): Promise<void> {
  await atomicStream(options.destinationPath, await encryptStream(createReadStream(options.sourcePath), options.recipients), { signal: options.signal })
}
export async function decryptFile(options: { sourcePath: string; destinationPath: string; identities: string[]; signal?: AbortSignal }): Promise<void> {
  await privateFile(options.sourcePath)
  await atomicStream(options.destinationPath, await decryptStream(createReadStream(options.sourcePath), options.identities), { signal: options.signal })
}
