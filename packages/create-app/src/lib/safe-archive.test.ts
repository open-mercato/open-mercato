import assert from 'node:assert/strict'
import test, { after } from 'node:test'
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gzipSync } from 'node:zlib'
import * as tar from 'tar'
import { downloadRepositoryTarball, extractTarballSnapshot, findTemplateFiles } from './ready-apps.js'
import {
  ARCHIVE_LIMITS,
  UnsafeArchiveError,
  assertRegularTree,
  extractArchive,
  inspectArchive,
  readCappedBody,
  type UnsafeArchiveRule,
} from './safe-archive.js'

const MIB = 1024 * 1024
const ROOT = 'acme-app-1a2b3c4'

const scratchDirs: string[] = []
const scratchDir = (prefix = 'om-safe-archive-') => {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  scratchDirs.push(dir)
  return dir
}

after(() => {
  for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true })
})

// Archive fixtures

type FsEntry =
  | { kind: 'file'; content?: string }
  | { kind: 'dir' }
  | { kind: 'symlink'; target: string }
  | { kind: 'hardlink'; target: string }

/**
 * Packs a real directory tree with `tar.c`, rooted in one top folder like a repository tarball. Packing is sync and
 * gzip is applied afterwards, because async `tar.c` with gzip fails at random on hard links.
 */
async function packTree(entries: Record<string, FsEntry>): Promise<string> {
  const dir = scratchDir('om-safe-archive-tree-')
  const root = join(dir, ROOT)
  mkdirSync(root)
  for (const [path, entry] of Object.entries(entries)) {
    const absolute = join(root, path)
    mkdirSync(dirname(absolute), { recursive: true })
    if (entry.kind === 'file') writeFileSync(absolute, entry.content ?? '')
    else if (entry.kind === 'dir') mkdirSync(absolute, { recursive: true })
    else if (entry.kind === 'symlink') symlinkSync(entry.target, absolute)
    else linkSync(join(root, entry.target), absolute)
  }
  const tarPath = join(dir, 'archive.tar')
  const archivePath = join(dir, 'archive.tar.gz')
  tar.c({ cwd: dir, file: tarPath, portable: true, sync: true }, [ROOT])
  writeFileSync(archivePath, gzipSync(readFileSync(tarPath)))
  return archivePath
}

type RawEntry = {
  path: string
  type?: 'File' | 'Directory' | 'SymbolicLink' | 'Link' | 'FIFO' | 'CharacterDevice' | 'BlockDevice' | 'ContiguousFile' | 'GlobalExtendedHeader'
  /** A raw type byte that `tar` does not know, written over the encoded header. */
  typeByte?: string
  body?: string
  /** Declared size without a body, for limit checks that fail on the header. */
  declaredSize?: number
  linkpath?: string
}

function encodeHeader(entry: RawEntry, size: number): Buffer {
  const block = Buffer.alloc(512)
  const type = entry.type ?? 'File'
  new tar.Header({
    path: entry.path,
    type,
    size,
    linkpath: entry.linkpath,
    mode: type === 'Directory' ? 0o755 : 0o644,
    uid: 0,
    gid: 0,
    mtime: new Date(0),
  }).encode(block, 0)
  if (entry.typeByte) {
    block[156] = entry.typeByte.charCodeAt(0)
    block.fill(0x20, 148, 156)
    let sum = 0
    for (const byte of block) sum += byte
    block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii')
  }
  return block
}

/** Writes tar blocks by hand, for entries `tar.c` will not produce (FIFO, devices, `..`, absolute, unknown types). */
function writeRawArchive(entries: RawEntry[]): string {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const body = Buffer.from(entry.body ?? '')
    blocks.push(encodeHeader(entry, entry.declaredSize ?? body.length))
    if (entry.declaredSize === undefined && body.length > 0) {
      blocks.push(body, Buffer.alloc((512 - (body.length % 512)) % 512))
    }
  }
  blocks.push(Buffer.alloc(1024))
  const archivePath = join(scratchDir('om-safe-archive-raw-'), 'archive.tar.gz')
  writeFileSync(archivePath, gzipSync(Buffer.concat(blocks)))
  return archivePath
}

async function assertRejected(
  promise: Promise<unknown>,
  rule: UnsafeArchiveRule,
  path: string | null,
  message: RegExp,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof UnsafeArchiveError, `expected UnsafeArchiveError, got ${String(error)}`)
    assert.equal(error.rule, rule)
    assert.equal(error.path, path)
    assert.match(error.message, message)
    if (path) assert.ok(error.message.includes(`"${path}"`), `message names the path: ${error.message}`)
    return true
  })
}

// Limits

test('ARCHIVE_LIMITS are the spec values: 64 MiB download, 10,000 entries, 128 MiB unpacked', () => {
  assert.deepEqual({ ...ARCHIVE_LIMITS }, { maxDownloadBytes: 64 * MIB, maxEntries: 10_000, maxUnpackedBytes: 128 * MIB })
  assert.ok(Object.isFrozen(ARCHIVE_LIMITS))
})

// Download

function trackedBody(chunks: number, chunkSize: number) {
  const state = { pulled: 0, canceled: false }
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled === chunks) return controller.close()
      state.pulled += 1
      controller.enqueue(new Uint8Array(chunkSize).fill(7))
    },
    cancel() {
      state.canceled = true
    },
  })
  return { stream, state }
}

test('readCappedBody streams the body into a temporary file and dispose removes it', async () => {
  const { stream } = trackedBody(4, 1000)
  const archive = await readCappedBody(new Response(stream), 'acme/app', { maxDownloadBytes: 4000 })
  try {
    assert.equal(archive.bytes, 4000)
    assert.equal(readFileSync(archive.path).byteLength, 4000)
  } finally {
    archive.dispose()
  }
  assert.equal(existsSync(archive.path), false)
})

test('readCappedBody stops a streamed body past the cap, cancels it and leaves no file', async () => {
  const savedTmp = process.env.TMPDIR
  const tempRoot = scratchDir('om-safe-archive-tmp-')
  process.env.TMPDIR = tempRoot
  try {
    const { stream, state } = trackedBody(1000, 1000)
    await assertRejected(
      readCappedBody(new Response(stream), 'acme/app', { maxDownloadBytes: 4500 }),
      'download-size',
      null,
      /^Download stopped: the archive of acme\/app is larger than 4500 bytes, the download limit for imported apps\.$/,
    )
    assert.ok(state.pulled < 1000, `stopped early after ${state.pulled} chunks`)
    assert.equal(state.canceled, true, 'the network body is canceled')
    assert.deepEqual(readdirSync(tempRoot), [], 'the partial download is removed')
  } finally {
    if (savedTmp === undefined) delete process.env.TMPDIR
    else process.env.TMPDIR = savedTmp
  }
})

test('a content-length above the 64 MiB cap fails the shared fetch before reading the body', async () => {
  const { stream, state } = trackedBody(10, 1000)
  const fetchImpl = (async () =>
    new Response(stream, { headers: { 'content-length': String(64 * MIB + 1) } })) as typeof fetch
  await assertRejected(
    downloadRepositoryTarball('acme', 'app', 'a'.repeat(40), '0.10.0', fetchImpl),
    'download-size',
    null,
    /the archive of acme\/app is larger than 64 MiB/,
  )
  assert.equal(state.pulled <= 1, true, 'the body is not read')
  assert.equal(state.canceled, true)
})

// Pass 1: entry types

test('inspectArchive rejects a symbolic link with its path', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{}' }, 'src/escape': { kind: 'symlink', target: '/etc/passwd' } })
  await assertRejected(inspectArchive(archivePath), 'entry-type', `${ROOT}/src/escape`, /is a symbolic link\. Imported apps may contain only files and directories\./)
})

test('inspectArchive rejects a symbolic link that points to itself', async () => {
  const archivePath = await packTree({ 'loop': { kind: 'symlink', target: 'loop' } })
  await assertRejected(inspectArchive(archivePath), 'entry-type', `${ROOT}/loop`, /is a symbolic link/)
})

test('inspectArchive rejects a hard link with its path', async () => {
  const archivePath = await packTree({ 'a.txt': { kind: 'file', content: 'same inode' }, 'b.txt': { kind: 'hardlink', target: 'a.txt' } })
  await assertRejected(inspectArchive(archivePath), 'entry-type', `${ROOT}/b.txt`, /is a hard link\./)
})

test('inspectArchive rejects FIFO, devices, contiguous and unknown entry types', async () => {
  const cases: Array<[RawEntry, RegExp]> = [
    [{ path: `${ROOT}/pipe`, type: 'FIFO' }, /is a FIFO\./],
    [{ path: `${ROOT}/tty`, type: 'CharacterDevice' }, /is a character device\./],
    [{ path: `${ROOT}/disk`, type: 'BlockDevice' }, /is a block device\./],
    [{ path: `${ROOT}/big.bin`, type: 'ContiguousFile', body: 'x' }, /is a contiguous file\./],
    [{ path: `${ROOT}/odd`, typeByte: 'Z' }, /is an entry of unsupported type/],
    [{ path: `${ROOT}/link-to-self`, type: 'Link', linkpath: `${ROOT}/link-to-self` }, /is a hard link\./],
  ]
  for (const [entry, message] of cases) {
    const archivePath = writeRawArchive([{ path: `${ROOT}/`, type: 'Directory' }, { path: `${ROOT}/ok.txt`, body: 'ok' }, entry])
    await assertRejected(inspectArchive(archivePath), 'entry-type', entry.path, message)
  }
})

// Pass 1: paths

test('inspectArchive rejects absolute paths, drive letters and ".." segments with the path', async () => {
  const cases: Array<[string, UnsafeArchiveRule, RegExp]> = [
    ['/etc/cron.d/job', 'absolute-path', /is an absolute path\./],
    ['C:/Windows/evil.txt', 'absolute-path', /is an absolute path\./],
    [`${ROOT}/../outside.txt`, 'parent-segment', /has a "\.\." segment\./],
    [`${ROOT}/src/..\\..\\outside.txt`, 'parent-segment', /has a "\.\." segment\./],
  ]
  for (const [path, rule, message] of cases) {
    const archivePath = writeRawArchive([{ path: `${ROOT}/`, type: 'Directory' }, { path, body: 'x' }])
    await assertRejected(inspectArchive(archivePath), rule, path, message)
  }
})

test('inspectArchive replaces control characters in a printed path', async () => {
  const path = `${ROOT}/\u001b[2Jlink`
  const archivePath = writeRawArchive([{ path, type: 'SymbolicLink', linkpath: '/tmp' }])
  await assert.rejects(inspectArchive(archivePath), (error: unknown) => {
    assert.ok(error instanceof UnsafeArchiveError)
    assert.equal(error.path, path)
    assert.ok(!error.message.includes('\u001b'), 'no escape sequence reaches the terminal')
    assert.match(error.message, /"acme-app-1a2b3c4\/\?\[2Jlink" is a symbolic link/)
    return true
  })
})

// Pass 1: counts and sizes

test('inspectArchive rejects more than 10,000 entries', async () => {
  const entries: RawEntry[] = [{ path: `${ROOT}/`, type: 'Directory' }]
  for (let index = 0; index < ARCHIVE_LIMITS.maxEntries; index += 1) entries.push({ path: `${ROOT}/d${index}/`, type: 'Directory' })
  await assertRejected(
    inspectArchive(writeRawArchive(entries)),
    'entry-count',
    null,
    /^Archive rejected: it has more than 10000 entries \(files and directories\), the limit for imported apps\.$/,
  )
  assert.deepEqual(await inspectArchive(writeRawArchive(entries.slice(1))), { entries: 10_000, unpackedBytes: 0 })
})

test('inspectArchive rejects files that unpack to more than 128 MiB, from the header alone', async () => {
  const archivePath = writeRawArchive([
    { path: `${ROOT}/`, type: 'Directory' },
    { path: `${ROOT}/small.txt`, body: 'x' },
    { path: `${ROOT}/huge.bin`, declaredSize: 128 * MIB },
  ])
  await assertRejected(inspectArchive(archivePath), 'unpacked-size', null, /its files unpack to more than 128 MiB, the limit for imported apps\./)
})

test('inspectArchive applies smaller limits when given', async () => {
  const archivePath = writeRawArchive([{ path: `${ROOT}/a.txt`, body: 'abcd' }, { path: `${ROOT}/b.txt`, body: 'efgh' }])
  await assertRejected(inspectArchive(archivePath, { maxEntries: 1, maxUnpackedBytes: 100 }), 'entry-count', null, /more than 1 entries/)
  await assertRejected(inspectArchive(archivePath, { maxEntries: 10, maxUnpackedBytes: 7 }), 'unpacked-size', null, /more than 7 bytes/)
  assert.deepEqual(await inspectArchive(archivePath, { maxEntries: 2, maxUnpackedBytes: 8 }), { entries: 2, unpackedBytes: 8 })

  const target = join(scratchDir(), 'my-app')
  const limits = { maxDownloadBytes: MIB, maxEntries: 1, maxUnpackedBytes: MIB }
  await assertRejected(extractTarballSnapshot(archivePath, target, { limits }), 'entry-count', null, /more than 1 entries/)
  assert.equal(existsSync(target), false)
})

test('inspectArchive does not count pax global headers, as in GitHub tarballs', async () => {
  const archivePath = writeRawArchive([
    { path: 'pax_global_header', type: 'GlobalExtendedHeader', body: '52 comment=1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b\n' },
    { path: `${ROOT}/`, type: 'Directory' },
    { path: `${ROOT}/package.json`, body: '{}\n' },
  ])
  assert.deepEqual(await inspectArchive(archivePath), { entries: 2, unpackedBytes: 3 })
})

test('inspectArchive rejects data that is not a tar archive', async () => {
  const archivePath = join(scratchDir(), 'archive.tar.gz')
  writeFileSync(archivePath, Uint8Array.from([1, 2, 3]))
  await assert.rejects(inspectArchive(archivePath), /Archive rejected: it is not a valid tar archive/)
})

// Pass 2 and the lstat walk

test('extractArchive skips links even without pass 1 (defense in depth)', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{}' }, 'escape': { kind: 'symlink', target: '..' } })
  const target = scratchDir()
  await extractArchive(archivePath, target)
  assert.deepEqual(readdirSync(target), ['package.json'])
})

test('assertRegularTree and findTemplateFiles walk with lstat and reject links with their path', () => {
  const target = scratchDir()
  mkdirSync(join(target, 'src'))
  writeFileSync(join(target, 'src', 'a.ts.template'), '')
  symlinkSync('/nonexistent/target', join(target, 'src', 'dangling'))
  assert.throws(() => assertRegularTree(target), (error: unknown) => {
    assert.ok(error instanceof UnsafeArchiveError)
    assert.equal(error.rule, 'not-regular')
    assert.equal(error.path, join('src', 'dangling'))
    assert.match(error.message, /"src\/dangling" is not a regular file or directory/)
    return true
  })
  assert.throws(() => findTemplateFiles(target), /"src\/dangling" is not a regular file or directory/)

  rmSync(join(target, 'src', 'dangling'))
  symlinkSync(target, join(target, 'src', 'cycle'))
  assert.throws(() => findTemplateFiles(target), /"src\/cycle" is not a regular file or directory/, 'a directory link is not followed')
  rmSync(join(target, 'src', 'cycle'))
  assert.deepEqual(findTemplateFiles(target), [join('src', 'a.ts.template')])
})

// The import: both passes, the target directory and cleanup

test('extractTarballSnapshot extracts a GitHub-style archive with the root folder stripped', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{"name":"x"}' }, 'src/modules.ts': { kind: 'file', content: 'export default []\n' } })
  const target = join(scratchDir(), 'nested', 'my-app')
  await extractTarballSnapshot(archivePath, target)
  assert.equal(readFileSync(join(target, 'package.json'), 'utf8'), '{"name":"x"}')
  assert.equal(existsSync(join(target, 'src', 'modules.ts')), true)
  assert.equal(existsSync(join(target, ROOT)), false)
})

test('a pass 1 failure writes nothing and does not create the target directory', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{}' }, 'escape': { kind: 'symlink', target: '/' } })
  const target = join(scratchDir(), 'my-app')
  await assertRejected(extractTarballSnapshot(archivePath, target, { removeTargetOnFailure: true }), 'entry-type', `${ROOT}/escape`, /symbolic link/)
  assert.equal(existsSync(target), false)
})

test('an existing target directory fails the import and is never written into or removed', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{}' } })
  const target = join(scratchDir(), 'my-app')
  mkdirSync(target)
  writeFileSync(join(target, 'keep.txt'), 'mine')
  await assert.rejects(
    extractTarballSnapshot(archivePath, target, { removeTargetOnFailure: true }),
    /appeared during the import\. It was left untouched\./,
  )
  assert.deepEqual(readdirSync(target), ['keep.txt'])
})

test('a failure after the target was created removes it only when asked (--template)', async () => {
  const archivePath = await packTree({ 'package.json': { kind: 'file', content: '{}' }, 'src/page.tsx.template': { kind: 'file' } })
  const failingCheck = () => {
    throw new Error('validation failed')
  }

  const removed = join(scratchDir(), 'template-app')
  await assert.rejects(extractTarballSnapshot(archivePath, removed, { removeTargetOnFailure: true, afterExtract: failingCheck }), /validation failed/)
  assert.equal(existsSync(removed), false)

  const kept = join(scratchDir(), 'ready-app')
  await assert.rejects(extractTarballSnapshot(archivePath, kept, { afterExtract: failingCheck }), /validation failed/)
  assert.equal(existsSync(join(kept, 'package.json')), true, '--app and --app-url keep today\'s behavior')
})
