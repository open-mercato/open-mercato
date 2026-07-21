import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  computeCounts,
  computeFindingsSummary,
  collectUserStories,
  EMPTY_FINDINGS_SUMMARY,
  mockupDocument,
  stableContentString,
  type MockupCounts,
  type MockupDocument,
  type MockupFinding,
  type MockupFindingsSummary,
  type MockupLayoutNode,
  type MockupStatus,
} from './schema'
import { copyFileSchema, type MockupCopyFile } from './copy'

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
  /** Hash of the CONTENT (findings stripped) — the reference for finding staleness. */
  contentHash: string
  /** Phase 3 — true while the document carries `draft: true` (generated, not yet reviewed). */
  draft: boolean
  document: MockupDocument | null
  issues: MockupIssue[] | null
  counts: MockupCounts
  userStories: string[]
  findings: MockupFindingsSummary
}

const EMPTY_COUNTS: MockupCounts = { implemented: 0, proposed: 0, omDefault: 0, placeholder: 0 }

function emptyFindings(): MockupFindingsSummary {
  return { ...EMPTY_FINDINGS_SUMMARY, bySeverity: { ...EMPTY_FINDINGS_SUMMARY.bySeverity } }
}

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

/**
 * Content hash for finding staleness: sha256 over the canonical, findings-free
 * serialization. Writing findings changes the file (`documentHash`) but not
 * this hash — a critique must not invalidate itself on write.
 */
export function computeContentHash(document: MockupDocument): string {
  return hashDocumentContent(stableContentString(document))
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
      contentHash: hashDocumentContent(''),
      draft: false,
      document: null,
      issues: [{ path: '(file)', message: 'Could not read the mockup file' }],
      counts: { ...EMPTY_COUNTS },
      userStories: [],
      findings: emptyFindings(),
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
      contentHash: documentHash,
      draft: false,
      document: null,
      issues: [{ path: '(file)', message: `Invalid JSON: ${(error as Error).message}` }],
      counts: { ...EMPTY_COUNTS },
      userStories: [],
      findings: emptyFindings(),
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
      contentHash: documentHash,
      draft: false,
      document: null,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.') || '(root)',
        message: issue.message,
      })),
      counts: { ...EMPTY_COUNTS },
      userStories: [],
      findings: emptyFindings(),
    }
  }
  const contentHash = computeContentHash(parsed.data)
  return {
    slug: parsed.data.slug,
    title: parsed.data.title,
    source,
    filePath,
    modifiedAt,
    documentHash,
    contentHash,
    draft: parsed.data.draft === true,
    document: parsed.data,
    issues: null,
    counts: computeCounts(parsed.data),
    userStories: collectUserStories(parsed.data),
    findings: computeFindingsSummary(parsed.data, contentHash),
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
  /** Phase 2 — replaces the leaf's findings wholesale when present. */
  findings?: MockupFinding[]
}

/**
 * Phase 3 — the never-auto-final guard for the annotation write contract.
 * The `draft` flag may only leave a document through the explicit `finalize`
 * intent: a request that touches `draft` any other way is rejected with the
 * returned message (422 at the route). Returns null when the request is fine.
 */
export function draftIntentIssue(input: { draft?: boolean; finalize?: boolean }): string | null {
  if (input.finalize !== undefined && input.finalize !== true) {
    return 'finalize must be true when present — it is an explicit intent, not a toggle'
  }
  if (input.draft === undefined) return null
  if (input.draft === true) {
    return 'Re-drafting through the annotations write is not supported — set draft: true by editing the document (studio or JSON)'
  }
  // draft: false — only honored alongside the explicit finalize intent.
  if (input.finalize !== true) {
    return 'Clearing the draft flag requires the explicit finalize intent — a draft is never auto-finalized'
  }
  return null
}

/**
 * Rewrites ONLY the annotation fields (`status`, `userStory`, `note`, and —
 * Phase 2 — `findings`) of the matching leaf nodes on the raw JSON tree;
 * layout, entries, and props are untouched byte-for-byte apart from JSON
 * re-serialization. `documentFindings`, when provided, replaces the
 * screen-level findings array. `finalize: true` (Phase 3) additionally clears
 * the document's `draft` flag — the ONLY code path that ever does.
 */
export function applyAnnotationsToDocument(
  raw: unknown,
  updates: AnnotationUpdate[],
  documentFindings?: MockupFinding[],
  finalize?: boolean,
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
      if (update.findings !== undefined) {
        if (update.findings.length === 0) delete record.findings
        else record.findings = update.findings
      }
      applied.add(record.id)
    }
    if (Array.isArray(record.children)) {
      for (const child of record.children) visit(child)
    }
  }

  const rootHolder = raw as { root?: unknown; documentFindings?: unknown; draft?: unknown } | null
  if (rootHolder && typeof rootHolder === 'object') {
    visit(rootHolder.root as MockupLayoutNode)
    if (documentFindings !== undefined) {
      if (documentFindings.length === 0) delete rootHolder.documentFindings
      else rootHolder.documentFindings = documentFindings
    }
    if (finalize === true) delete rootHolder.draft
  }

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
  documentFindings?: MockupFinding[],
  finalize?: boolean,
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
  const { document, unknownIds } = applyAnnotationsToDocument(raw, updates, documentFindings, finalize)
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

// ---------------------------------------------------------------------------
// Full-document write (Phase 2 — studio save)
// ---------------------------------------------------------------------------

export type DocumentWriteResult =
  | { ok: true; documentHash: string; contentHash: string; counts: MockupCounts }
  | { ok: false; status: number; error: string; issues?: MockupIssue[] }

/**
 * Studio save: replaces the whole document under the same dev-mode + path
 * containment guards as the annotation write, plus optimistic concurrency —
 * `baseHash` must match the CURRENT on-disk `documentHash` or the write is a
 * 409 (someone — human, agent, or another studio tab — edited the file since
 * this client loaded it). The document must already have passed schema AND
 * registry-integrity validation (the route does both before calling this).
 */
export function writeMockupDocument(
  mockup: LoadedMockup,
  document: MockupDocument,
  baseHash: string,
  repoRoot: string | null = findRepoRoot(),
): DocumentWriteResult {
  if (!mockupWritesEnabled()) return { ok: false, status: 404, error: 'Not found' }
  if (!repoRoot || !isPathInside(mockup.filePath, repoRoot)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  if (document.slug !== mockup.slug) {
    return { ok: false, status: 422, error: 'Document slug must match the target mockup' }
  }
  // Re-read at write time: the loaded snapshot may be stale.
  let currentContent: string
  try {
    currentContent = fs.readFileSync(mockup.filePath, 'utf8')
  } catch {
    return { ok: false, status: 404, error: 'Not found' }
  }
  if (hashDocumentContent(currentContent) !== baseHash) {
    return {
      ok: false,
      status: 409,
      error: 'The document changed on disk since it was loaded — reload and reapply your edits',
    }
  }
  const serialized = `${JSON.stringify(document, null, 2)}\n`
  fs.writeFileSync(mockup.filePath, serialized, 'utf8')
  return {
    ok: true,
    documentHash: hashDocumentContent(serialized),
    contentHash: computeContentHash(document),
    counts: computeCounts(document),
  }
}

// ---------------------------------------------------------------------------
// Companion copy files (Phase 2 — om-ux-copy)
// ---------------------------------------------------------------------------

/** `<file>.mockup.json` → `<file>.copy.json` beside it. */
export function copyFilePathFor(mockupFilePath: string): string {
  return mockupFilePath.replace(/\.mockup\.json$/, '.copy.json')
}

/**
 * Loads the mockup's companion copy file when present and valid; a missing or
 * invalid file yields `null` (the committed-fixture test asserts validity —
 * the renderer just falls back to the sample props).
 */
export function loadCopyFileFor(mockup: LoadedMockup): MockupCopyFile | null {
  const filePath = copyFilePathFor(mockup.filePath)
  let content: string
  try {
    if (!fs.existsSync(filePath)) return null
    content = fs.readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = copyFileSchema.safeParse(JSON.parse(content))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

/** All committed copy files (for the integrity test). */
export function discoverCopyFiles(
  repoRoot: string | null = findRepoRoot(),
): Array<{ filePath: string; mockupFilePath: string }> {
  return discoverMockupFiles(repoRoot)
    .map(({ filePath }) => ({ filePath: copyFilePathFor(filePath), mockupFilePath: filePath }))
    .filter(({ filePath }) => fs.existsSync(filePath))
}
