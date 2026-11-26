import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Row actions go through `RowActions`, not through buttons laid out by hand.
 *
 * Four screens built their own `<div className="flex justify-end gap-1">` of outline buttons, so the same act
 * looked different on every list: no overflow menu, no destructive styling on a delete, nothing the design
 * system can restyle once, and a row with three actions as wide as the column.
 *
 * Only the ACTIONS moved. The inbound-hooks cell also carries two explanations — "URL hidden — needs campaign
 * management rights" and "No signing secret configured" — which are why there is nothing to click rather than
 * things to click, and burying either in a dropdown would answer neither.
 */
const BACKEND_ROOT = join(__dirname, '..')

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__') return []
    if (statSync(path).isDirectory()) return pageFiles(path)
    return entry === 'page.tsx' ? [path] : []
  })
}

const pages = pageFiles(BACKEND_ROOT).map((path) => ({
  relative: path.slice(path.indexOf('/backend/') + 1),
  source: readFileSync(path, 'utf8'),
}))

/** The columns a table renders as its trailing action cell. */
const withActionColumn = pages.filter(({ source }) => source.includes("id: 'actions'"))

describe('backend row actions', () => {
  it('finds the screens it is meant to be guarding', () => {
    expect(withActionColumn.length).toBeGreaterThanOrEqual(5)
  })

  for (const { relative, source } of withActionColumn) {
    it(`${relative} renders them through RowActions`, () => {
      expect(source).toContain('<RowActions ')
    })

    it(`${relative} lays out no button row of its own`, () => {
      // The exact shape four screens had: an end-justified flex of outline buttons inside the cell.
      expect(/className="flex justify-end gap-1"/.test(source)).toBe(false)
    })
  }

  it('marks a destructive action as destructive rather than leaving it to look ordinary', () => {
    // A delete that looks like an edit is a delete somebody clicks by accident.
    const destructive = withActionColumn.filter(({ source }) => /label: t\('[^']*(?:removeNode|action\.delete)/.test(source))
    expect(destructive.length).toBeGreaterThan(0)
    for (const { relative, source } of destructive) {
      expect([relative, source.includes('destructive: true')]).toEqual([relative, true])
    }
  })
})
