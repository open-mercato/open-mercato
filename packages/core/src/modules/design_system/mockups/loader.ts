import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  computeCounts,
  collectUserStories,
  mockupDocument,
  type MockupCounts,
  type MockupDocument,
  type MockupLayoutNode,
  type MockupStatus,
} from './schema'

/**
 * Server-side mockup discovery and (dev-only) annotation write-back.
 *
 * Two sources, per the spec:
 * - `.ai/mockups/<slug>.mockup.json` — spec-stage artifacts at the repo root
 *   (absent from production builds; the list simply shows fewer rows).
 * - `packages/<pkg>/src/modules/<module>/mockups/<slug>.mockup.json` —
 *   module-local mockups shipped next to the module they describe.
 *
 * This file uses `node:fs` and must only be imported from API routes / server
 * code — never from client components.
 */

export type MockupSource = 'ai' | 'module'

export type MockupIssue = { path: string; message: string }

export type LoadedMockup = {
  slug: string
  title: string
  source: MockupSource
  filePath: string
  modifiedAt: string
  documentHash: string
  document: MockupDocument | null
  issues: MockupIssue[] | null
  counts: MockupCounts
  userStories: string[]
}

const EMPTY_COUNTS: MockupCounts = { implemented: 0, proposed: 0, omDefault: 0, placeholder: 0 }

/** Walk up from `start` to the workspace root (marked by yarn.lock). */
export function findRepoRoot(start: string = process.cwd()): string | null {
  let current = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(current, 'yarn.lock'))) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** True when `child` resolves inside `parent` — the write containment guard. */
export function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function listMockupFilesIn(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.mockup.json'))
    .map((name) => path.join(dir, name))
    .filter((filePath) => {
      try {
        return fs.statSync(filePath).isFile()
      } catch {
        return false
      }
    })
    .sort()
}

export function discoverMockupFiles(repoRoot: string | null = findRepoRoot()): Array<{
  filePath: string
  source: MockupSource
}> {
  if (!repoRoot) return []
  const found: Array<{ filePath: string; source: MockupSource }> = []
  for (const filePath of listMockupFilesIn(path.join(repoRoot, '.ai', 'mockups'))) {
    found.push({ filePath, source: 'ai' })
  }
  const packagesDir = path.join(repoRoot, 'packages')
  if (fs.existsSync(packagesDir)) {
    for (const pkg of fs.readdirSync(packagesDir).sort()) {
      const modulesDir = path.join(packagesDir, pkg, 'src', 'modules')
      if (!fs.existsSync(modulesDir)) continue
      for (const moduleName of fs.readdirSync(modulesDir).sort()) {
        const mockupsDir = path.join(modulesDir, moduleName, 'mockups')
        for (const filePath of listMockupFilesIn(mockupsDir)) {
          found.push({ filePath, source: 'module' })
        }
      }
    }
  }
  return found
}

export function hashDocumentContent(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

function slugFromFileName(filePath: string): string {
  return path.basename(filePath).replace(/\.mockup\.json$/, '')
}

export function loadMockupFile(filePath: string, source: MockupSource): LoadedMockup {
  let content = ''
  let modifiedAt = new Date(0).toISOString()
  try {
    content = fs.readFileSync(filePath, 'utf8')
    modifiedAt = fs.statSync(filePath).mtime.toISOString()
  } catch {
    return {
      slug: slugFromFileName(filePath),
      title: slugFromFileName(filePath),
      source,
      filePath,
      modifiedAt,
      documentHash: hashDocumentContent(''),
      document: null,
      issues: [{ path: '(file)', message: 'Could not read the mockup file' }],
      counts: { ...EMPTY_COUNTS },
      userStories: [],
    }
  }
  const documentHash = hashDocumentContent(content)
  let raw: unknown
  try {
    raw = JSON.parse(content)
  } catch (error) {
    return {
      slug: slugFromFileName(filePath),
      title: slugFromFileName(filePath),
      source,
      filePath,
      modifiedAt,
      documentHash,
      document: null,
      issues: [{ path: '(file)', message: `Invalid JSON: ${(error as Error).message}` }],
      counts: { ...EMPTY_COUNTS },
      userStories: [],
    }
  }
  const parsed = mockupDocument.safeParse(raw)
  if (!parsed.success) {
    const rawTitle =
      typeof (raw as { title?: unknown } | null)?.title === 'string'
        ? ((raw as { title: string }).title)
        : slugFromFileName(filePath)
    return {
      slug: slugFromFileName(filePath),
      title: rawTitle,
      source,
      filePath,
      modifiedAt,
      documentHash,
      document: null,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      counts: { ...EMPTY_COUNTS },
      userStories: [],
    }
  }
  return {
    slug: parsed.data.slug,
    title: parsed.data.title,
    source,
    filePath,
    modifiedAt,
    documentHash,
    document: parsed.data,
    issues: null,
    counts: computeCounts(parsed.data),
    userStories: collectUserStories(parsed.data),
  }
}

export function loadMockups(repoRoot: string | null = findRepoRoot()): LoadedMockup[] {
  return discoverMockupFiles(repoRoot).map(({ filePath, source }) => loadMockupFile(filePath, source))
}

export function getMockupBySlug(
  slug: string,
  repoRoot: string | null = findRepoRoot(),
): LoadedMockup | null {
  // Slugs are unique across sources (integrity test enforces); first match wins.
  return loadMockups(repoRoot).find((mockup) => mockup.slug === slug) ?? null
}

// ---------------------------------------------------------------------------
// Dev-only annotation write-back
// ---------------------------------------------------------------------------

/** The annotation PUT is only wired in development — never in shared environments. */
export function mockupWritesEnabled(): boolean {
  return process.env.NODE_ENV === 'development'
}

export type AnnotationUpdate = {
  id: string
  status: MockupStatus
  userStory?: string
  note?: string
}

/**
 * Rewrites ONLY the annotation fields (`status`, `userStory`, `note`) of the
 * matching leaf nodes on the raw JSON tree — layout, entries, and props are
 * untouched byte-for-byte apart from JSON re-serialization.
 */
export function applyAnnotationsToDocument(
  raw: unknown,
  updates: AnnotationUpdate[],
): { document: unknown; unknownIds: string[] } {
  const byId = new Map(updates.map((update) => [update.id, update]))
  const applied = new Set<string>()

  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (
      (record.type === 'block' || record.type === 'placeholder') &&
      typeof record.id === 'string' &&
      byId.has(record.id)
    ) {
      const update = byId.get(record.id)!
      record.status = update.status
      if (update.userStory === undefined) delete record.userStory
      else record.userStory = update.userStory
      if (update.note === undefined) delete record.note
      else record.note = update.note
      applied.add(record.id)
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child)
    }
  }

  const rootHolder = raw as { root?: unknown } | null
  if (rootHolder && typeof rootHolder === 'object') visit(rootHolder.root as MockupLayoutNode)

  const unknownIds = updates.map((update) => update.id).filter((id) => !applied.has(id))
  return { document: raw, unknownIds }
}

export type AnnotationWriteResult =
  | { ok: true; documentHash: string; counts: MockupCounts }
  | { ok: false; status: number; error: string; issues?: MockupIssue[] }

export function writeAnnotations(
  mockup: LoadedMockup,
  updates: AnnotationUpdate[],
  repoRoot: string | null = findRepoRoot(),
): AnnotationWriteResult {
  if (!mockupWritesEnabled()) return { ok: false, status: 404, error: 'Not found' }
  if (!repoRoot || !isPathInside(mockup.filePath, repoRoot)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  if (!mockup.document) {
    return {
      ok: false,
      status: 422,
      error: 'Mockup document is invalid',
      issues: mockup.issues ?? undefined,
    }
  }
  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(mockup.filePath, 'utf8'))
  } catch {
    return { ok: false, status: 422, error: 'Mockup document is invalid' }
  }
  const { document, unknownIds } = applyAnnotationsToDocument(raw, updates)
  if (unknownIds.length > 0) {
    return { ok: false, status: 422, error: `Unknown block id(s): ${unknownIds.join(', ')}` }
  }
  const reparsed = mockupDocument.safeParse(document)
  if (!reparsed.success) {
    return {
      ok: false,
      status: 422,
      error: 'Annotations would produce an invalid document',
      issues: reparsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
    }
  }
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  fs.writeFileSync(mockup.filePath, serialized, 'utf8')
  return {
    ok: true,
    documentHash: hashDocumentContent(serialized),
    counts: computeCounts(reparsed.data),
  }
}
