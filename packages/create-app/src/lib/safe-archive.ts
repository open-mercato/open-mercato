import { createReadStream, createWriteStream, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import * as tar from 'tar'

const MIB = 1024 * 1024

export interface ArchiveLimits {
  /** Bytes read from the network, counted while streaming. */
  maxDownloadBytes: number
  /** Files and directories in the archive. Pax and GNU metadata headers are not entries. */
  maxEntries: number
  /** Sum of the file sizes once unpacked. */
  maxUnpackedBytes: number
}

/**
 * Limits for every imported archive (`--app`, `--app-url`, `--template`). They sit above the catalog's own tarball
 * limits (50 MB unpacked, 5,000 files), so a template that passes catalog validation always imports.
 */
export const ARCHIVE_LIMITS: Readonly<ArchiveLimits> = Object.freeze({
  maxDownloadBytes: 64 * MIB,
  maxEntries: 10_000,
  maxUnpackedBytes: 128 * MIB,
})

export type UnsafeArchiveRule =
  | 'download-size'
  | 'entry-count'
  | 'unpacked-size'
  | 'entry-type'
  | 'absolute-path'
  | 'parent-segment'
  | 'not-regular'

/** An archive or extracted tree that breaks one rule; `path` names the offending entry when there is one. */
export class UnsafeArchiveError extends Error {
  readonly rule: UnsafeArchiveRule
  readonly path: string | null

  constructor(rule: UnsafeArchiveRule, message: string, path: string | null = null) {
    super(message)
    this.name = 'UnsafeArchiveError'
    this.rule = rule
    this.path = path
  }
}

/** An archive saved to a temporary file. Call `dispose` once it is extracted or no longer needed. */
export interface DownloadedArchive {
  path: string
  bytes: number
  dispose: () => void
}

// The only entry types an imported app may hold. `OldFile` is the pre-POSIX type for a regular file.
const FILE_TYPES = new Set(['File', 'OldFile'])
const DIRECTORY_TYPES = new Set(['Directory'])

const ENTRY_TYPE_NAMES: Record<string, string> = {
  SymbolicLink: 'a symbolic link',
  Link: 'a hard link',
  CharacterDevice: 'a character device',
  BlockDevice: 'a block device',
  FIFO: 'a FIFO',
  ContiguousFile: 'a contiguous file',
  GNUDumpDir: 'a GNU dump directory',
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g
const MAX_SHOWN_PATH_LENGTH = 300

/** A path from the archive, safe to print: control characters replaced, length capped. */
function shownPath(path: string): string {
  const printable = path.replace(CONTROL_CHARACTERS, '?')
  return printable.length > MAX_SHOWN_PATH_LENGTH ? `${printable.slice(0, MAX_SHOWN_PATH_LENGTH)}...` : printable
}

function formatBytes(bytes: number): string {
  return bytes % MIB === 0 ? `${bytes / MIB} MiB` : `${bytes} bytes`
}

function downloadLimitError(source: string, maxBytes: number): UnsafeArchiveError {
  return new UnsafeArchiveError(
    'download-size',
    `Download stopped: the archive of ${source} is larger than ${formatBytes(maxBytes)}, the download limit for imported apps.`,
  )
}

/**
 * Streams a response body into a temporary file and stops once it passes `maxDownloadBytes`. A `content-length`
 * above the limit fails before any byte is read. Nothing is buffered whole.
 */
export type CappedBodyOptions = {
  /** Aborting it stops the stream, removes the partial file and rejects with the abort reason. */
  signal?: AbortSignal
  /** Called for every chunk read, so a caller can measure stalls. */
  onChunk?: () => void
}

export async function readCappedBody(
  response: Response,
  source: string,
  limits: Pick<ArchiveLimits, 'maxDownloadBytes'> = ARCHIVE_LIMITS,
  options: CappedBodyOptions = {},
): Promise<DownloadedArchive> {
  const maxBytes = limits.maxDownloadBytes
  const declaredLength = Number(response.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw downloadLimitError(source, maxBytes)
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'create-mercato-app-archive-'))
  const dispose = () => rmSync(tempDir, { recursive: true, force: true })
  const path = join(tempDir, 'archive.tar.gz')
  let bytes = 0

  try {
    const body = response.body
      ? Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>)
      : Readable.from([])
    await pipeline(
      body,
      async function* countBytes(chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          bytes += chunk.byteLength
          if (bytes > maxBytes) throw downloadLimitError(source, maxBytes)
          options.onChunk?.()
          yield chunk
        }
      },
      createWriteStream(path, { flags: 'wx' }),
      options.signal ? { signal: options.signal } : {},
    )
  } catch (error) {
    dispose()
    throw error
  }

  return { path, bytes, dispose }
}

/** Why an archive path is unsafe, or null. Both separators count, so a Windows `..\` is caught on any platform. */
function unsafePathRule(path: string): { rule: UnsafeArchiveRule; reason: string } | null {
  if (path.startsWith('/') || path.startsWith('\\') || /^[a-zA-Z]:/u.test(path)) {
    return { rule: 'absolute-path', reason: 'is an absolute path' }
  }
  if (path.split(/[\\/]/u).includes('..')) {
    return { rule: 'parent-segment', reason: 'has a ".." segment' }
  }
  return null
}

function entryTypeError(path: string, type: string): UnsafeArchiveError {
  const kind = ENTRY_TYPE_NAMES[type] ?? `an entry of unsupported type "${shownPath(type)}"`
  return new UnsafeArchiveError(
    'entry-type',
    `Archive rejected: "${shownPath(path)}" is ${kind}. Imported apps may contain only files and directories.`,
    path,
  )
}

export interface ArchiveSummary {
  entries: number
  unpackedBytes: number
}

/**
 * Pass 1: reads the whole archive without writing anything and fails on the first entry that breaks a rule:
 * a type other than file or directory, an absolute path, a `..` segment, or the entry and unpacked size limits.
 */
export async function inspectArchive(
  archivePath: string,
  limits: Pick<ArchiveLimits, 'maxEntries' | 'maxUnpackedBytes'> = ARCHIVE_LIMITS,
): Promise<ArchiveSummary> {
  return new Promise<ArchiveSummary>((resolvePromise, rejectPromise) => {
    const input = createReadStream(archivePath)
    const parser = new tar.Parser({ strict: true })
    let entries = 0
    let unpackedBytes = 0
    let settled = false

    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      input.destroy()
      rejectPromise(error)
    }

    const check = (entry: tar.ReadEntry): UnsafeArchiveError | null => {
      const isFile = FILE_TYPES.has(entry.type)
      if (!isFile && !DIRECTORY_TYPES.has(entry.type)) return entryTypeError(entry.path, entry.type)

      const pathRule = unsafePathRule(entry.path)
      if (pathRule) {
        return new UnsafeArchiveError(pathRule.rule, `Archive rejected: "${shownPath(entry.path)}" ${pathRule.reason}.`, entry.path)
      }

      entries += 1
      if (entries > limits.maxEntries) {
        return new UnsafeArchiveError(
          'entry-count',
          `Archive rejected: it has more than ${limits.maxEntries} entries (files and directories), the limit for imported apps.`,
        )
      }

      if (isFile) unpackedBytes += entry.size ?? 0
      if (unpackedBytes > limits.maxUnpackedBytes) {
        return new UnsafeArchiveError(
          'unpacked-size',
          `Archive rejected: its files unpack to more than ${formatBytes(limits.maxUnpackedBytes)}, the limit for imported apps.`,
        )
      }
      return null
    }

    parser.on('entry', (entry: tar.ReadEntry) => {
      const problem = settled ? null : check(entry)
      if (problem) fail(problem)
      entry.resume()
    })
    // The parser skips unknown entry types (and oversized metadata) instead of emitting them; an unknown type is unsafe.
    parser.on('ignoredEntry', (entry: tar.ReadEntry) => {
      if (!entry.meta) fail(entryTypeError(entry.path, entry.type))
    })
    parser.on('error', (error: Error) => fail(new Error(`Archive rejected: it is not a valid tar archive (${error.message}).`)))
    parser.on('end', () => {
      if (settled) return
      settled = true
      resolvePromise({ entries, unpackedBytes })
    })
    input.on('error', fail)
    input.pipe(parser)
  })
}

/**
 * Pass 2: extracts into an existing directory, dropping the GitHub root folder. The filter admits only files and
 * directories, as a second line of defense after `inspectArchive`.
 */
export async function extractArchive(archivePath: string, targetDir: string): Promise<void> {
  await tar.x({
    cwd: targetDir,
    file: archivePath,
    strip: 1,
    strict: true,
    preservePaths: false,
    preserveOwner: false,
    filter: (_path, entry) => {
      const type = 'type' in entry ? entry.type : null
      return type !== null && (FILE_TYPES.has(type) || DIRECTORY_TYPES.has(type))
    },
  })
}

/**
 * Walks a tree with `lstat`, never following links, and returns its regular files as sorted paths relative to
 * `rootDir`. Any entry that is not a regular file or a directory fails with its path.
 */
export function listRegularFiles(dir: string, rootDir: string = dir): string[] {
  const files: string[] = []
  const names = readdirSync(dir).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

  for (const name of names) {
    const entryPath = join(dir, name)
    const entryStat = lstatSync(entryPath)
    if (entryStat.isDirectory()) {
      files.push(...listRegularFiles(entryPath, rootDir))
    } else if (entryStat.isFile()) {
      files.push(relative(rootDir, entryPath))
    } else {
      const shown = shownPath(relative(rootDir, entryPath))
      throw new UnsafeArchiveError(
        'not-regular',
        `Imported app rejected: "${shown}" is not a regular file or directory.`,
        relative(rootDir, entryPath),
      )
    }
  }

  return files
}

/** Fails when the extracted tree holds anything other than regular files and directories. */
export function assertRegularTree(dir: string): void {
  listRegularFiles(dir)
}

/**
 * Creates the target directory itself without `recursive`, so a directory that appeared since the existence check
 * fails the import instead of being written into. Missing parent directories are created first.
 */
export function createTargetDirectory(targetDir: string): void {
  mkdirSync(dirname(targetDir), { recursive: true })
  try {
    mkdirSync(targetDir)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new Error(`Directory "${targetDir}" appeared during the import. It was left untouched.`)
    }
    throw error
  }
}
