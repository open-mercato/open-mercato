import fs from 'node:fs'
import path from 'node:path'

/**
 * Destructive-affordance weight audit for the workflows module.
 *
 * Every affordance that OPENS a destructive flow — "Delete step", "Delete
 * route", "Remove activity", "Clear canvas" — renders light: `destructive-outline`
 * (red border + red label on the page background) or `destructive-ghost` for
 * icon-only affordances inside an otherwise-ghost row. The heavy solid
 * `variant="destructive"` is reserved for the LAST irreversible click, which in
 * this module always lives inside the shared `ConfirmDialog` (whose own
 * `variant="destructive"` prop is a different contract and is not a Button
 * variant).
 *
 * Without this guard the sweep rots one PR at a time: a new delete button
 * copied from an older file reintroduces a solid red fill next to an outlined
 * one, and a row that mixes weights reads as two different actions.
 *
 * Scope is derived by walking the module's own UI trees, so a new component or
 * backend page is covered the moment it is added. Only `Button` / `IconButton`
 * are constrained — `Badge`, `Alert` and `ConfirmDialog` carry an unrelated
 * `variant`/`status` vocabulary.
 */

const MODULE_ROOT = path.join(__dirname, '..', '..')
const SCAN_ROOTS = ['components', 'backend']
const SCANNED_EXTENSIONS = ['.tsx']
const CONSTRAINED_TAGS = new Set(['Button', 'IconButton'])
const SOLID_DESTRUCTIVE = 'variant="destructive"'
/** How far back a `variant=` line may sit from its own opening tag. */
const MAX_TAG_LOOKBEHIND = 15

function collectFiles(dir: string, acc: string[]): string[] {
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__integration__') continue
      collectFiles(full, acc)
      continue
    }
    if (SCANNED_EXTENSIONS.includes(path.extname(entry.name))) acc.push(full)
  }
  return acc
}

/** The JSX tag the `variant=` on `lineIndex` belongs to, or null when unresolved. */
function resolveOwningTag(lines: string[], lineIndex: number): string | null {
  const sameLine = /<([A-Z][A-Za-z0-9]*)\b[^>]*variant="destructive"/.exec(lines[lineIndex])
  if (sameLine) return sameLine[1]
  for (let cursor = lineIndex - 1; cursor >= 0 && lineIndex - cursor <= MAX_TAG_LOOKBEHIND; cursor -= 1) {
    const match = /<([A-Z][A-Za-z0-9]*)\b/.exec(lines[cursor])
    if (match) return match[1]
  }
  return null
}

function findSolidDestructiveButtons(filePath: string): string[] {
  const source = fs.readFileSync(filePath, 'utf8')
  if (!source.includes(SOLID_DESTRUCTIVE)) return []
  const lines = source.split('\n')
  const relative = path.relative(MODULE_ROOT, filePath)
  const hits: string[] = []
  lines.forEach((line, index) => {
    if (!line.includes(SOLID_DESTRUCTIVE)) return
    const tag = resolveOwningTag(lines, index)
    if (tag && CONSTRAINED_TAGS.has(tag)) {
      hits.push(`${relative}:${index + 1} <${tag} ${SOLID_DESTRUCTIVE}> — use destructive-outline (or destructive-ghost for icon-only rows)`)
    }
  })
  return hits
}

const scannedFiles = SCAN_ROOTS.flatMap((root) => collectFiles(path.join(MODULE_ROOT, root), []))

describe('workflows destructive button weight', () => {
  it('scans the module UI trees', () => {
    expect(scannedFiles.length).toBeGreaterThan(20)
  })

  it('renders no solid destructive Button/IconButton', () => {
    expect(scannedFiles.flatMap(findSolidDestructiveButtons)).toEqual([])
  })

  it('still recognises a solid destructive Button when one is written', () => {
    const sample = [
      '<Button',
      '  type="button"',
      '  variant="destructive"',
      '>',
    ]
    expect(resolveOwningTag(sample, 2)).toBe('Button')
    expect(CONSTRAINED_TAGS.has(resolveOwningTag(sample, 2) as string)).toBe(true)
  })

  it('leaves Badge, Alert and ConfirmDialog variants alone', () => {
    const badge = ['<Badge variant="destructive" className="text-xs">']
    expect(CONSTRAINED_TAGS.has(resolveOwningTag(badge, 0) as string)).toBe(false)
    const confirm = ['<ConfirmDialog', '  onConfirm={remove}', '  variant="destructive"', '/>']
    expect(CONSTRAINED_TAGS.has(resolveOwningTag(confirm, 2) as string)).toBe(false)
  })
})
