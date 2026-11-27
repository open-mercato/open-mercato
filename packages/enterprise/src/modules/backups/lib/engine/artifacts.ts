import { constants, createReadStream } from 'node:fs'
import { lstat, mkdir, open, realpath, statfs, link, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ByteStream } from './types'
import { BackupError, checkAbort } from './errors'
import { collect } from './streams'

export async function privateDirectory(path: string, create = false): Promise<void> {
  if (!isAbsolute(path)) throw new BackupError('BACKUP_ABSOLUTE_PATH_REQUIRED', 2)
  if (create) await mkdir(path, { recursive: true, mode: 0o700 })
  const info = await lstat(path)
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new BackupError('BACKUP_PRIVATE_DIRECTORY_REQUIRED', 3)
}
export async function privateFile(path: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new BackupError('BACKUP_PRIVATE_FILE_REQUIRED', 3)
}
export async function contained(root: string, path: string): Promise<string> {
  if (isAbsolute(path)) throw new BackupError('BACKUP_UNSAFE_PATH', 4)
  const target = resolve(root, path)
  const offset = relative(root, target)
  if (offset.startsWith(`..${sep}`) || offset === '..' || !offset) throw new BackupError('BACKUP_UNSAFE_PATH', 4)
  const parent = await realpath(dirname(target))
  const rootPath = await realpath(root)
  if (parent !== rootPath && !parent.startsWith(rootPath + sep)) throw new BackupError('BACKUP_UNSAFE_PATH', 4)
  return target
}
export async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try { await handle.sync() } finally { await handle.close() }
}
export async function atomicStream(path: string, source: ByteStream, options: { signal?: AbortSignal; maxBytes?: number; reserveBytes?: bigint } = {}): Promise<{ sha256: string; bytes: number }> {
  const temporary = `${path}.${randomUUID()}.partial`
  const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
  const hash = createHash('sha256')
  let size = 0
  try {
    const disk = await statfs(dirname(path), { bigint: true })
    if (disk.bavail * disk.bsize < (options.reserveBytes ?? 0n)) throw new BackupError('BACKUP_DISK_RESERVE', 5, true)
    for await (const chunk of source) {
      checkAbort(options.signal)
      size += chunk.byteLength
      if (options.maxBytes !== undefined && size > options.maxBytes) throw new BackupError('BACKUP_OUTPUT_LIMIT', 5, true)
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.byteLength) {
        const result = await handle.write(chunk, offset, chunk.byteLength - offset)
        if (!result.bytesWritten) throw new BackupError('BACKUP_WRITE_FAILED', 5, true)
        offset += result.bytesWritten
      }
    }
    await handle.sync()
    await handle.close()
    await link(temporary, path)
    await unlink(temporary)
    await syncDirectory(dirname(path))
    return { sha256: hash.digest('hex'), bytes: size }
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(temporary).catch(() => undefined)
    if (error instanceof BackupError) throw error
    throw new BackupError('BACKUP_IO_FAILED', 5, true)
  }
}
export async function digestFile(path: string, signal?: AbortSignal): Promise<{ sha256: string; bytes: number }> {
  await privateFile(path)
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of (await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)).createReadStream({ highWaterMark: 1024 * 1024 })) {
    checkAbort(signal)
    hash.update(chunk)
    size += chunk.byteLength
  }
  return { sha256: hash.digest('hex'), bytes: size }
}

export async function readBoundedFile(path: string, maximum: number): Promise<Buffer> {
  await privateFile(path)
  return collect((await open(path, constants.O_RDONLY | constants.O_NOFOLLOW)).createReadStream({ highWaterMark: 65536 }), maximum)
}
