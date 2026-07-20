import fs from 'node:fs'
import path from 'node:path'
import {
  findRepoRoot,
  getMockupBySlug,
  isPathInside,
  loadMockupFile,
  type LoadedMockup,
} from './loader'

/**
 * Named version snapshots (spec 2026-07-05-ds-live-mockup-composer.md, Phase 2).
 * A snapshot is an ordinary schema-valid copy of the document at
 * `.ai/mockups/versions/<slug>@<label>.mockup.json` — covered by the same
 * registry-integrity test as live documents. Created via
 * `yarn ds:mockups:snapshot <slug> <label>` or the studio action.
 *
 * Server-only (node:fs) — never import from client components.
 */

export const SNAPSHOT_LABEL_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

export function versionsDir(repoRoot: string): string {
  return path.join(repoRoot, '.ai', 'mockups', 'versions')
}

export type MockupSnapshotRef = {
  slug: string
  label: string
  filePath: string
  createdAt: string
}

function parseSnapshotFileName(fileName: string): { slug: string; label: string } | null {
  const match = /^([a-z0-9-]+)@([a-z0-9._-]+)\.mockup\.json$/.exec(fileName)
  if (!match) return null
  return { slug: match[1], label: match[2] }
}

export function discoverSnapshotFiles(
  repoRoot: string | null = findRepoRoot(),
): MockupSnapshotRef[] {
  if (!repoRoot) return []
  const dir = versionsDir(repoRoot)
  if (!fs.existsSync(dir)) return []
  const refs: MockupSnapshotRef[] = []
  for (const name of fs.readdirSync(dir).sort()) {
    const parsed = parseSnapshotFileName(name)
    if (!parsed) continue
    const filePath = path.join(dir, name)
    let createdAt = new Date(0).toISOString()
    try {
      if (!fs.statSync(filePath).isFile()) continue
      createdAt = fs.statSync(filePath).mtime.toISOString()
    } catch {
      continue
    }
    refs.push({ slug: parsed.slug, label: parsed.label, filePath, createdAt })
  }
  return refs
}

export function listSnapshots(
  slug: string,
  repoRoot: string | null = findRepoRoot(),
): MockupSnapshotRef[] {
  return discoverSnapshotFiles(repoRoot).filter((ref) => ref.slug === slug)
}

export function loadSnapshot(
  slug: string,
  label: string,
  repoRoot: string | null = findRepoRoot(),
): LoadedMockup | null {
  const ref = listSnapshots(slug, repoRoot).find((candidate) => candidate.label === label)
  if (!ref) return null
  return loadMockupFile(ref.filePath, 'ai')
}

export type SnapshotCreateResult =
  | { ok: true; label: string; filePath: string }
  | { ok: false; status: number; error: string }

/**
 * Copies the current on-disk document (byte-for-byte) to the versions folder.
 * Refuses invalid documents, malformed labels, existing labels, and any path
 * outside the working tree. Dev-mode gating is the CALLER's job: the API
 * route requires `mockupWritesEnabled()`, the CLI runs in a local checkout by
 * definition.
 */
export function createSnapshot(
  slug: string,
  label: string,
  repoRoot: string | null = findRepoRoot(),
): SnapshotCreateResult {
  if (!repoRoot) return { ok: false, status: 404, error: 'Not found' }
  if (!SNAPSHOT_LABEL_PATTERN.test(label)) {
    return { ok: false, status: 422, error: 'Invalid snapshot label (use a-z, 0-9, ., _, -)' }
  }
  const mockup = getMockupBySlug(slug, repoRoot)
  if (!mockup) return { ok: false, status: 404, error: 'Not found' }
  if (!mockup.document) {
    return { ok: false, status: 422, error: 'Mockup document is invalid — fix it before snapshotting' }
  }
  if (!isPathInside(mockup.filePath, repoRoot)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  const dir = versionsDir(repoRoot)
  const filePath = path.join(dir, `${slug}@${label}.mockup.json`)
  if (!isPathInside(filePath, repoRoot)) {
    return { ok: false, status: 404, error: 'Not found' }
  }
  if (fs.existsSync(filePath)) {
    return { ok: false, status: 409, error: `Snapshot label "${label}" already exists for "${slug}"` }
  }
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(mockup.filePath, filePath)
  return { ok: true, label, filePath }
}
