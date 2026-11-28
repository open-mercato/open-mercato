import fs from 'node:fs'
import path from 'node:path'
import {
  BLOCK_TARGET_DIR,
  compareCanonical,
  hashContent,
  listBlockIds,
  readBlockSource,
  type BlockSource,
} from './ui-blocks-source'

export const BLOCKS_LOCK_FILE = 'blocks.lock.json'
export const BLOCKS_LOCK_VERSION = 1

const MODULE_ID_PATTERN = /^[a-z][a-z0-9_]*$/
const DIFF_CONTEXT_LINES = 3

export type BlockLockEntry = {
  package: string
  packageVersion: string
  hash: string
  target: string
  files: Record<string, string>
}

export type BlocksLock = {
  version: number
  blocks: Record<string, BlockLockEntry>
}

export type UiBlocksContext = {
  appDir: string
  uiPackageRoot: string
}

export type AddBlockResult = {
  blockId: string
  moduleId: string
  action: 'installed' | 'updated' | 'unchanged'
  targetDir: string
  lockPath: string
  written: string[]
  removed: string[]
  packageVersion: string
  hash: string
}

export type BlockFileDiff = {
  path: string
  status: 'modified' | 'missing-locally' | 'local-only'
  patch: string
}

export type BlockDiffResult = {
  blockId: string
  moduleId: string
  lockedVersion: string | null
  registryVersion: string
  registryChanged: boolean
  localEdits: string[]
  files: BlockFileDiff[]
}

function resolveModuleDir(context: UiBlocksContext, moduleId: string): string {
  if (!MODULE_ID_PATTERN.test(moduleId)) {
    throw new Error(`Invalid module id "${moduleId}". Module ids are snake_case, for example "service_orders".`)
  }
  const moduleDir = path.join(context.appDir, 'src', 'modules', moduleId)
  if (!fs.existsSync(moduleDir) || !fs.statSync(moduleDir).isDirectory()) {
    throw new Error(
      `Module "${moduleId}" was not found in ${path.join('src', 'modules')}. Blocks are copied into app modules only; create the module first.`,
    )
  }
  return moduleDir
}

function isLockEntry(value: unknown): value is BlockLockEntry {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.package === 'string' &&
    typeof record.packageVersion === 'string' &&
    typeof record.hash === 'string' &&
    typeof record.target === 'string' &&
    !!record.files &&
    typeof record.files === 'object' &&
    Object.values(record.files).every((hash) => typeof hash === 'string')
  )
}

export function readBlocksLock(moduleDir: string): BlocksLock {
  const lockPath = path.join(moduleDir, BLOCKS_LOCK_FILE)
  if (!fs.existsSync(lockPath)) return { version: BLOCKS_LOCK_VERSION, blocks: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'))
  } catch {
    throw new Error(`Cannot parse ${lockPath}. Fix or remove the file and run the command again.`)
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  if (record.version !== BLOCKS_LOCK_VERSION) {
    throw new Error(`Unsupported ${BLOCKS_LOCK_FILE} version in ${lockPath}. Expected ${BLOCKS_LOCK_VERSION}.`)
  }
  const blocks: Record<string, BlockLockEntry> = {}
  const rawBlocks = record.blocks && typeof record.blocks === 'object' ? (record.blocks as Record<string, unknown>) : {}
  for (const [blockId, entry] of Object.entries(rawBlocks)) {
    if (!isLockEntry(entry)) throw new Error(`Invalid entry for block "${blockId}" in ${lockPath}.`)
    blocks[blockId] = entry
  }
  return { version: BLOCKS_LOCK_VERSION, blocks }
}

function writeBlocksLock(moduleDir: string, lock: BlocksLock): string {
  const lockPath = path.join(moduleDir, BLOCKS_LOCK_FILE)
  const sortedBlocks = Object.fromEntries(
    Object.entries(lock.blocks)
      .sort(([left], [right]) => compareCanonical(left, right))
      .map(([blockId, entry]) => [
        blockId,
        { ...entry, files: Object.fromEntries(Object.entries(entry.files).sort(([left], [right]) => compareCanonical(left, right))) },
      ]),
  )
  fs.writeFileSync(lockPath, `${JSON.stringify({ version: lock.version, blocks: sortedBlocks }, null, 2)}\n`)
  return lockPath
}

function listLocalFiles(dir: string, base: string = dir): string[] {
  if (!fs.existsSync(dir)) return []
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listLocalFiles(fullPath, base))
      continue
    }
    files.push(path.relative(base, fullPath).split(path.sep).join('/'))
  }
  return files.sort(compareCanonical)
}

function readLocalFile(targetDir: string, filePath: string): string | null {
  const fullPath = path.join(targetDir, filePath)
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : null
}

export function findLocalEdits(targetDir: string, lockEntry: BlockLockEntry): string[] {
  const edits = new Set<string>()
  for (const [filePath, lockedHash] of Object.entries(lockEntry.files)) {
    const content = readLocalFile(targetDir, filePath)
    if (content === null || hashContent(content) !== lockedHash) edits.add(filePath)
  }
  for (const filePath of listLocalFiles(targetDir)) {
    if (!(filePath in lockEntry.files)) edits.add(filePath)
  }
  return Array.from(edits).sort(compareCanonical)
}

function isSameLockEntry(left: BlockLockEntry, right: BlockLockEntry): boolean {
  const leftPaths = Object.keys(left.files)
  return (
    left.package === right.package &&
    left.packageVersion === right.packageVersion &&
    left.hash === right.hash &&
    left.target === right.target &&
    leftPaths.length === Object.keys(right.files).length &&
    leftPaths.every((filePath) => left.files[filePath] === right.files[filePath])
  )
}

function removeEmptyDirs(dir: string, stopAt: string): void {
  let current = dir
  while (current.startsWith(stopAt) && current !== stopAt) {
    if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) return
    fs.rmdirSync(current)
    current = path.dirname(current)
  }
}

export function listAvailableBlocks(context: UiBlocksContext): BlockSource[] {
  return listBlockIds(context.uiPackageRoot).map((blockId) => readBlockSource(context.uiPackageRoot, blockId))
}

export function addBlock(
  context: UiBlocksContext,
  blockId: string,
  moduleId: string,
  options: { force?: boolean } = {},
): AddBlockResult {
  const source = readBlockSource(context.uiPackageRoot, blockId)
  const moduleDir = resolveModuleDir(context, moduleId)
  const target = `${BLOCK_TARGET_DIR}/${blockId}`
  const targetDir = path.join(moduleDir, ...target.split('/'))
  const lock = readBlocksLock(moduleDir)
  const lockEntry = lock.blocks[blockId]
  const existingFiles = listLocalFiles(targetDir)

  if (!lockEntry && existingFiles.length > 0 && !options.force) {
    throw new Error(
      `${path.relative(context.appDir, targetDir)} already contains files that ${BLOCKS_LOCK_FILE} does not track. ` +
        'Move them away or pass --force to overwrite.',
    )
  }

  const localEdits = lockEntry ? findLocalEdits(targetDir, lockEntry) : []
  if (localEdits.length > 0 && !options.force) {
    throw new Error(
      `Block "${blockId}" in module "${moduleId}" has local changes: ${localEdits.join(', ')}. ` +
        `Run "mercato ui diff ${blockId} --module ${moduleId}" to review them, or pass --force to overwrite.`,
    )
  }

  const sourcePaths = new Set(source.files.map((file) => file.path))
  const written: string[] = []
  for (const file of source.files) {
    if (readLocalFile(targetDir, file.path) === file.content) continue
    const destination = path.join(targetDir, ...file.path.split('/'))
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, file.content)
    written.push(file.path)
  }

  const removed: string[] = []
  for (const filePath of Object.keys(lockEntry?.files ?? {})) {
    if (sourcePaths.has(filePath)) continue
    const stale = path.join(targetDir, ...filePath.split('/'))
    if (!fs.existsSync(stale)) continue
    fs.rmSync(stale)
    removeEmptyDirs(path.dirname(stale), targetDir)
    removed.push(filePath)
  }

  const nextEntry: BlockLockEntry = {
    package: source.packageName,
    packageVersion: source.packageVersion,
    hash: source.hash,
    target,
    files: Object.fromEntries(source.files.map((file) => [file.path, file.hash])),
  }
  const lockUnchanged = !!lockEntry && isSameLockEntry(lockEntry, nextEntry)
  const lockPath = lockUnchanged
    ? path.join(moduleDir, BLOCKS_LOCK_FILE)
    : writeBlocksLock(moduleDir, { ...lock, blocks: { ...lock.blocks, [blockId]: nextEntry } })

  const action: AddBlockResult['action'] = !lockEntry
    ? 'installed'
    : written.length === 0 && removed.length === 0 && lockUnchanged
      ? 'unchanged'
      : 'updated'

  return {
    blockId,
    moduleId,
    action,
    targetDir,
    lockPath,
    written,
    removed,
    packageVersion: source.packageVersion,
    hash: source.hash,
  }
}

type DiffOp = { kind: 'same' | 'remove' | 'add'; line: string }

function splitLines(content: string): string[] {
  if (content === '') return []
  const lines = content.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function diffLines(before: string[], after: string[]): DiffOp[] {
  const rows = before.length
  const columns = after.length
  const lengths: Uint32Array[] = Array.from({ length: rows + 1 }, () => new Uint32Array(columns + 1))
  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let column = columns - 1; column >= 0; column -= 1) {
      lengths[row][column] =
        before[row] === after[column]
          ? lengths[row + 1][column + 1] + 1
          : Math.max(lengths[row + 1][column], lengths[row][column + 1])
    }
  }
  const ops: DiffOp[] = []
  let row = 0
  let column = 0
  while (row < rows && column < columns) {
    if (before[row] === after[column]) {
      ops.push({ kind: 'same', line: before[row] })
      row += 1
      column += 1
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      ops.push({ kind: 'remove', line: before[row] })
      row += 1
    } else {
      ops.push({ kind: 'add', line: after[column] })
      column += 1
    }
  }
  while (row < rows) ops.push({ kind: 'remove', line: before[row++] })
  while (column < columns) ops.push({ kind: 'add', line: after[column++] })
  return ops
}

export function createUnifiedDiff(filePath: string, before: string, after: string): string {
  const ops = diffLines(splitLines(before), splitLines(after))
  const changed = ops.map((op, index) => (op.kind === 'same' ? -1 : index)).filter((index) => index >= 0)
  if (changed.length === 0) return ''

  const hunks: Array<{ start: number; end: number }> = []
  for (const index of changed) {
    const start = Math.max(0, index - DIFF_CONTEXT_LINES)
    const end = Math.min(ops.length - 1, index + DIFF_CONTEXT_LINES)
    const last = hunks[hunks.length - 1]
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end)
    else hunks.push({ start, end })
  }

  const beforeLineAt: number[] = []
  const afterLineAt: number[] = []
  let beforeLine = 1
  let afterLine = 1
  for (const op of ops) {
    beforeLineAt.push(beforeLine)
    afterLineAt.push(afterLine)
    if (op.kind !== 'add') beforeLine += 1
    if (op.kind !== 'remove') afterLine += 1
  }

  const output = [`--- registry/${filePath}`, `+++ local/${filePath}`]
  for (const hunk of hunks) {
    const slice = ops.slice(hunk.start, hunk.end + 1)
    const beforeCount = slice.filter((op) => op.kind !== 'add').length
    const afterCount = slice.filter((op) => op.kind !== 'remove').length
    output.push(`@@ -${beforeLineAt[hunk.start]},${beforeCount} +${afterLineAt[hunk.start]},${afterCount} @@`)
    for (const op of slice) {
      const marker = op.kind === 'same' ? ' ' : op.kind === 'remove' ? '-' : '+'
      output.push(`${marker}${op.line}`)
    }
  }
  return `${output.join('\n')}\n`
}

export function diffBlock(context: UiBlocksContext, blockId: string, moduleId: string): BlockDiffResult {
  const source = readBlockSource(context.uiPackageRoot, blockId)
  const moduleDir = resolveModuleDir(context, moduleId)
  const lock = readBlocksLock(moduleDir)
  const lockEntry = lock.blocks[blockId]
  const target = lockEntry?.target ?? `${BLOCK_TARGET_DIR}/${blockId}`
  const targetDir = path.join(moduleDir, ...target.split('/'))
  const localFiles = listLocalFiles(targetDir)
  if (!lockEntry && localFiles.length === 0) {
    throw new Error(
      `Block "${blockId}" is not installed in module "${moduleId}". Run "mercato ui add ${blockId} --module ${moduleId}" first.`,
    )
  }

  const registryByPath = new Map(source.files.map((file) => [file.path, file.content]))
  const files: BlockFileDiff[] = []
  for (const filePath of Array.from(new Set([...registryByPath.keys(), ...localFiles])).sort(compareCanonical)) {
    const registryContent = registryByPath.get(filePath)
    const localContent = readLocalFile(targetDir, filePath)
    if (registryContent === localContent) continue
    files.push({
      path: filePath,
      status: localContent === null ? 'missing-locally' : registryContent === undefined ? 'local-only' : 'modified',
      patch: createUnifiedDiff(filePath, registryContent ?? '', localContent ?? ''),
    })
  }

  return {
    blockId,
    moduleId,
    lockedVersion: lockEntry?.packageVersion ?? null,
    registryVersion: source.packageVersion,
    registryChanged: !!lockEntry && lockEntry.hash !== source.hash,
    localEdits: lockEntry ? findLocalEdits(targetDir, lockEntry) : localFiles,
    files,
  }
}

export function listInstalledBlockIds(context: UiBlocksContext, moduleId: string): string[] {
  return Object.keys(readBlocksLock(resolveModuleDir(context, moduleId)).blocks).sort(compareCanonical)
}
