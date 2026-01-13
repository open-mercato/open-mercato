import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export type ChecksumRecord = {
  content: string
  structure: string
}

export interface GeneratorResult {
  filesWritten: string[]
  filesUnchanged: string[]
  errors: string[]
}

export function calculateChecksum(content: string): string {
  return crypto.createHash('md5').update(content).digest('hex')
}

export function readChecksumRecord(filePath: string): ChecksumRecord | null {
  if (!fs.existsSync(filePath)) {
    return null
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<ChecksumRecord>
    if (parsed && typeof parsed.content === 'string' && typeof parsed.structure === 'string') {
      return { content: parsed.content, structure: parsed.structure }
    }
  } catch {
    // Invalid checksum file
  }
  return null
}

export function writeChecksumRecord(filePath: string, record: ChecksumRecord): void {
  fs.writeFileSync(filePath, JSON.stringify(record) + '\n')
}

function collectStructureEntries(target: string, base: string, acc: string[]): void {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(target, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    acc.push(`error:${path.relative(base, target)}:${(err as Error).message}`)
    return
  }

  for (const entry of entries) {
    const fullPath = path.join(target, entry.name)
    const rel = path.relative(base, fullPath)
    try {
      const stat = fs.statSync(fullPath)
      if (entry.isDirectory()) {
        acc.push(`dir:${rel}:${stat.mtimeMs}`)
        collectStructureEntries(fullPath, base, acc)
      } else if (entry.isFile()) {
        acc.push(`file:${rel}:${stat.size}:${stat.mtimeMs}`)
      } else {
        acc.push(`other:${rel}:${stat.mtimeMs}`)
      }
    } catch {
      // File was deleted between readdir and stat - skip it
      continue
    }
  }
}

export function calculateStructureChecksum(paths: string[]): string {
  const normalized = Array.from(new Set(paths.map((p) => path.resolve(p)))).sort()
  const entries: string[] = []
  for (const target of normalized) {
    if (!fs.existsSync(target)) {
      entries.push(`missing:${target}`)
      continue
    }
    const stat = fs.statSync(target)
    entries.push(`${stat.isDirectory() ? 'dir' : 'file'}:${target}:${stat.mtimeMs}`)
    if (stat.isDirectory()) collectStructureEntries(target, target, entries)
  }
  return calculateChecksum(entries.join('\n'))
}

export function writeIfChanged(
  filePath: string,
  content: string,
  checksumPath?: string,
  structureChecksum?: string
): boolean {
  const newChecksum = calculateChecksum(content)

  if (checksumPath) {
    const existingRecord = readChecksumRecord(checksumPath)
    const newRecord: ChecksumRecord = {
      content: newChecksum,
      structure: structureChecksum || '',
    }

    const shouldWrite =
      !existingRecord ||
      existingRecord.content !== newRecord.content ||
      (structureChecksum && existingRecord.structure !== newRecord.structure)

    if (shouldWrite) {
      ensureDir(filePath)
      fs.writeFileSync(filePath, content)
      writeChecksumRecord(checksumPath, newRecord)
      return true
    }
    return false
  }

  // Simple comparison without checksum file
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8')
    if (existing === content) {
      return false
    }
  }

  ensureDir(filePath)
  fs.writeFileSync(filePath, content)
  return true
}

export function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

const ALLOWED_RIMRAF_PATTERNS = ['/generated/', '/dist/', '/.mercato/', '/entities/']

export function rimrafDir(dir: string, opts?: { allowedPatterns?: string[] }): void {
  if (!fs.existsSync(dir)) return

  // Safety check: only allow deletion within known safe directories
  const resolved = path.resolve(dir)
  const allowed = opts?.allowedPatterns ?? ALLOWED_RIMRAF_PATTERNS

  if (!allowed.some((pattern) => resolved.includes(pattern))) {
    throw new Error(`Refusing to delete directory outside allowed paths: ${resolved}. Allowed patterns: ${allowed.join(', ')}`)
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) rimrafDir(p, opts)
    else fs.unlinkSync(p)
  }
  fs.rmdirSync(dir)
}

export function toVar(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

export function toSnake(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/\W+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase()
}

export async function moduleHasExport(filePath: string, exportName: string): Promise<boolean> {
  try {
    const mod = await import(filePath)
    return mod != null && Object.prototype.hasOwnProperty.call(mod, exportName)
  } catch {
    return false
  }
}

export function logGenerationResult(label: string, changed: boolean): void {
  if (changed) {
    console.log(`Generated ${label}`)
  }
}

export function createGeneratorResult(): GeneratorResult {
  return {
    filesWritten: [],
    filesUnchanged: [],
    errors: [],
  }
}
