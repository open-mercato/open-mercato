import { spawn } from 'node:child_process'
import { mkdtemp, realpath, rm, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import { atomicStream, privateDirectory } from './artifacts'
import { BackupError, checkAbort } from './errors'
import type { ByteStream } from './types'

export type SchemaInspectionOptions = { workspace: string; binariesDir: string; maxStagingBytes?: number; signal?: AbortSignal }
export type SchemaInspector = (stream: ByteStream, sourceMajor: number) => Promise<void>

/** Offline archive inspection deliberately has no connection or credential options. */
export function createPostgresSchemaInspector(options: SchemaInspectionOptions): SchemaInspector {
  return async (stream, sourceMajor) => {
    checkAbort(options.signal)
    if (![16, 17, 18].includes(sourceMajor)) throw new BackupError('BACKUP_POSTGRES_VERSION_OR_IDENTITY', 2)
    await privateDirectory(options.workspace)
    if (!isAbsolute(options.binariesDir)) throw new BackupError('BACKUP_BINARIES_DIRECTORY', 2)
    const directory = await realpath(options.binariesDir)
    const directoryInfo = await stat(directory)
    if (!directoryInfo.isDirectory() || directoryInfo.mode & 0o022) throw new BackupError('BACKUP_BINARIES_WRITABLE', 3)
    const executable = await realpath(join(directory, 'pg_restore'))
    const info = await stat(executable)
    if (!info.isFile() || info.mode & 0o022 || !(info.mode & 0o111)) throw new BackupError('BACKUP_BINARY_UNSAFE', 3)
    const maximum = options.maxStagingBytes ?? 1024 * 1024 * 1024
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new BackupError('BACKUP_STAGING_LIMIT_INVALID', 2)
    const invoke = async (args: string[], version = false): Promise<string> => {
      const child = spawn(executable, args, { env: { PATH: directory, LC_ALL: 'C', TZ: 'UTC' }, stdio: ['ignore', 'pipe', 'pipe'] })
      let failure: BackupError | undefined
      let bytes = 0, lineBytes = 0
      const chunks: Buffer[] = []
      const stop = (error: BackupError) => { failure ??= error; child.kill('SIGKILL') }
      const abort = () => {
        try { checkAbort(options.signal) } catch (error) { stop(error as BackupError) }
      }
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
      const timeout = setTimeout(() => stop(new BackupError('BACKUP_SCHEMA_INSPECTION_TIMEOUT', 5, true)), 60000)
      timeout.unref()
      // Drain diagnostics without retaining or exposing archive names or native output.
      child.stderr.on('data', () => undefined)
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > (version ? 4096 : 64 * 1024 * 1024)) { stop(new BackupError('BACKUP_SCHEMA_TOC_LIMIT', 4)); return }
        for (const byte of chunk) {
          lineBytes = byte === 10 ? 0 : lineBytes + 1
          if (lineBytes > 4096) { stop(new BackupError('BACKUP_SCHEMA_TOC_LIMIT', 4)); return }
        }
        if (version) chunks.push(Buffer.from(chunk))
      })
      try {
        const code = await new Promise<number | null>((resolve) => {
          child.once('error', () => { failure ??= new BackupError('BACKUP_SCHEMA_INSPECTION_FAILED', 4); resolve(null) })
          child.once('close', resolve)
        })
        if (failure) throw failure
        if (code !== 0) throw new BackupError('BACKUP_SCHEMA_INSPECTION_FAILED', 4)
        return Buffer.concat(chunks).toString('utf8')
      } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); if (child.exitCode === null) child.kill('SIGKILL') }
    }
    const version = await invoke(['--version'], true)
    if (Number(/\(PostgreSQL\) (\d+)/.exec(version)?.[1]) !== sourceMajor) throw new BackupError('BACKUP_CLIENT_MAJOR_MISMATCH', 2)
    const staging = await mkdtemp(join(options.workspace, 'schema-inspection-'))
    try {
      const archive = join(staging, 'schema.dump')
      await atomicStream(archive, stream, { signal: options.signal, maxBytes: maximum })
      await invoke(['--list', archive])
    } finally { await rm(staging, { recursive: true, force: true }) }
  }
}
