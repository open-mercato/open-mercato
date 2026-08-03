import fs from 'node:fs'
import path from 'node:path'
import { galleryFamilies } from '../registry'

/**
 * Coverage guard — the mechanism that keeps the gallery living.
 *
 * Every file in `packages/ui/src/primitives` must either have a gallery entry
 * (matched via the entry's `importPath`) or an explicit allowlist reason
 * below. A new primitive without either fails CI.
 */

// Files that are not standalone visual components and will never get an entry.
const NON_COMPONENT: Record<string, string> = {
  'date-format.ts': 'Date formatting helpers, no visual component.',
  'date-picker-helpers.ts': 'Shared date-picker parsing/formatting helpers, no visual component.',
  'label.tsx': 'Form label sub-primitive shown through FormField/inputs, not a standalone entry.',
  'notification-stack.tsx': 'Imperative stacking host for notification primitives, no standalone visual.',
}

// Deprecated primitives are deliberately NOT showcased: rendering them would
// add imports that the DS health check counts toward zero targets, and the
// gallery must model current canon, not retired APIs.
const DEPRECATED: Record<string, string> = {
  'Notice.tsx': 'Deprecated - superseded by Alert (health-check target: 0 imports).',
  'ErrorNotice.tsx': 'Deprecated - superseded by Alert status="error" (health-check target: 0 imports).',
  'DataLoader.tsx': 'Deprecated loading wrapper - superseded by LoadingMessage/Skeleton patterns.',
}

// Primitives whose families are not seeded yet. This list MUST shrink as
// families land (it is empty once all families ship) and MUST NOT contain
// files that are already covered - the honesty test below enforces both.
const PENDING_FAMILIES: Record<string, string> = {
}

const PRIMITIVES_DIR = path.resolve(__dirname, '../../../../../..', 'ui/src/primitives')

function listPrimitiveFiles(): string[] {
  return fs
    .readdirSync(PRIMITIVES_DIR, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && /\.(ts|tsx)$/.test(dirent.name))
    .map((dirent) => dirent.name)
    .sort()
}

async function coveredPrimitiveFiles(): Promise<Set<string>> {
  const covered = new Set<string>()
  const modules = await Promise.all(galleryFamilies.map((family) => family.load()))
  for (const mod of modules) {
    for (const entry of mod.entries) {
      const match = entry.importPath.match(/^@open-mercato\/ui\/primitives\/(.+)$/)
      if (match) covered.add(`${match[1]}.tsx`)
    }
  }
  return covered
}

describe('design_system gallery coverage guard', () => {
  it('accounts for every file in packages/ui/src/primitives', async () => {
    const covered = await coveredPrimitiveFiles()
    const missing = listPrimitiveFiles().filter(
      (file) => !covered.has(file) && !(file in NON_COMPONENT) && !(file in PENDING_FAMILIES) && !(file in DEPRECATED),
    )
    // A non-empty diff here means a primitive landed without a gallery entry:
    // add the entry (preferred) or an allowlist row with a one-line reason.
    expect(missing).toEqual([])
  })

  it('keeps the allowlists honest (no stale or already-covered files)', async () => {
    const covered = await coveredPrimitiveFiles()
    const files = new Set(listPrimitiveFiles())
    const allowlisted = [...Object.keys(NON_COMPONENT), ...Object.keys(PENDING_FAMILIES), ...Object.keys(DEPRECATED)]

    const stale = allowlisted.filter((file) => !files.has(file))
    expect(stale).toEqual([])

    const alreadyCovered = allowlisted.filter((file) => covered.has(file))
    expect(alreadyCovered).toEqual([])

    const doubleListed = allowlisted.filter(
      (file, index) => allowlisted.indexOf(file) !== index,
    )
    expect(doubleListed).toEqual([])
  })
})
