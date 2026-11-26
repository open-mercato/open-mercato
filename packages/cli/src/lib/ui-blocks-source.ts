import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const UI_PACKAGE_NAME = '@open-mercato/ui'
export const BLOCK_CONTRACTS_IMPORT = '@open-mercato/ui/blocks/contracts'
export const BLOCK_TARGET_DIR = 'components/blocks'

const BLOCKS_DIR = path.join('src', 'blocks')
const NON_BLOCK_DIRS = new Set(['__tests__', 'contracts', 'inventory'])
const SKIPPED_NAMES = new Set(['__tests__', '__mocks__', 'node_modules', '.DS_Store'])
const DEMO_FILES = new Set(['fixtures.ts', 'fixtures.tsx'])
const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const BLOCK_ID_PATTERN = /^[a-z][a-z0-9-]*$/
const SPECIFIER_PATTERN = /(\bfrom\s+|\bimport\s+|\bimport\(\s*)(['"])([^'"\n]+)\2/g
const FIXTURE_EXPORT_PATTERN = /^export\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"]\.\/fixtures['"];?[ \t]*\r?\n/gm

export type BlockSourceFile = {
  path: string
  content: string
  hash: string
}

export type BlockSource = {
  id: string
  packageName: string
  packageVersion: string
  hash: string
  files: BlockSourceFile[]
}

export function hashContent(content: string): string {
  return `sha256-${crypto.createHash('sha256').update(content).digest('hex')}`
}

export function hashFiles(files: ReadonlyArray<{ path: string; hash: string }>): string {
  const lines = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}\n${file.hash}\n`)
  return hashContent(lines.join(''))
}

export function isValidBlockId(blockId: string): boolean {
  return BLOCK_ID_PATTERN.test(blockId)
}

function toPosix(relativePath: string): string {
  return relativePath.split(path.sep).join('/')
}

function collectFiles(dir: string, base: string): string[] {
  const files: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_NAMES.has(entry.name) || entry.name.startsWith('._')) continue
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectFiles(fullPath, base))
      continue
    }
    if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) continue
    if (DEMO_FILES.has(entry.name)) continue
    files.push(toPosix(path.relative(base, fullPath)))
  }
  return files.sort()
}

function rewriteSpecifier(blockId: string, filePath: string, specifier: string): string {
  if (!specifier.startsWith('.')) return specifier
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(filePath), specifier))
  if (!resolved.startsWith('..')) return specifier
  if (/^\.\.\/contracts(\/|$)/.test(resolved)) return BLOCK_CONTRACTS_IMPORT
  throw new Error(
    `[internal] Block "${blockId}" file ${filePath} imports "${specifier}", which is outside the block and has no public import path.`,
  )
}

export function transformBlockFile(blockId: string, filePath: string, content: string): string {
  const withoutFixtures = content.replace(FIXTURE_EXPORT_PATTERN, '')
  return withoutFixtures.replace(SPECIFIER_PATTERN, (_match, prefix: string, quote: string, specifier: string) => {
    return `${prefix}${quote}${rewriteSpecifier(blockId, filePath, specifier)}${quote}`
  })
}

export function listBlockIds(uiPackageRoot: string): string[] {
  const blocksRoot = path.join(uiPackageRoot, BLOCKS_DIR)
  if (!fs.existsSync(blocksRoot)) return []
  return fs
    .readdirSync(blocksRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !NON_BLOCK_DIRS.has(entry.name) && isValidBlockId(entry.name))
    .filter((entry) => fs.existsSync(path.join(blocksRoot, entry.name, 'index.ts')))
    .map((entry) => entry.name)
    .sort()
}

function readPackageManifest(uiPackageRoot: string): { name: string; version: string } {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(uiPackageRoot, 'package.json'), 'utf8'))
  const record = manifest && typeof manifest === 'object' ? (manifest as Record<string, unknown>) : {}
  return {
    name: typeof record.name === 'string' ? record.name : UI_PACKAGE_NAME,
    version: typeof record.version === 'string' ? record.version : '0.0.0',
  }
}

export function readBlockSource(uiPackageRoot: string, blockId: string): BlockSource {
  const available = listBlockIds(uiPackageRoot)
  if (!isValidBlockId(blockId) || !available.includes(blockId)) {
    throw new Error(`Unknown block "${blockId}". Available blocks: ${available.join(', ') || 'none'}.`)
  }
  const blockDir = path.join(uiPackageRoot, BLOCKS_DIR, blockId)
  const files = collectFiles(blockDir, blockDir).map((filePath) => {
    const content = transformBlockFile(blockId, filePath, fs.readFileSync(path.join(blockDir, filePath), 'utf8'))
    return { path: filePath, content, hash: hashContent(content) }
  })
  const manifest = readPackageManifest(uiPackageRoot)
  return {
    id: blockId,
    packageName: manifest.name,
    packageVersion: manifest.version,
    hash: hashFiles(files),
    files,
  }
}

export function listImportSpecifiers(content: string): string[] {
  return Array.from(content.matchAll(SPECIFIER_PATTERN), (match) => match[3])
}
