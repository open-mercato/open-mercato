import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Every state-changing write on a backend screen runs through `useGuardedMutation`.
 *
 * `AGENTS.md` makes it mandatory for a backend page that cannot use `CrudForm`, and none of the fifteen here
 * can — they are a canvas, side-panel editors and a settings form, not record CRUD. Going around it costs the
 * global mutation injections: record locks, the conflict and merge dialogs, approval hooks, and whatever the
 * platform adds next. The writes worked perfectly without it, which is exactly why the omission survived
 * review; a guard added to the platform later would simply not have covered marketing.
 *
 * Asserted against the source because the alternative is rendering fifteen screens. A page that adds a
 * `method: 'POST'` without a `runMutation` beside it fails here on the first run.
 *
 * READ-ONLY POSTs are exempt and named individually. Several endpoints in this module are queries that happen
 * to take a body — the audience estimate, the journey preview, the render, the AI draft, the delivery
 * explanation. Wrapping those would put a record-lock dialog in front of a question.
 */
const BACKEND_ROOT = join(__dirname, '..')

/** Paths whose POST asks something rather than changes something. */
const READ_ONLY_POST = ['audience-estimate', '/preview', '/render', '/draft-copy', '/explain', '/rescore']

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (entry === '__tests__') return []
    if (statSync(path).isDirectory()) return pageFiles(path)
    return entry === 'page.tsx' ? [path] : []
  })
}

describe('backend writes', () => {
  const pages = pageFiles(BACKEND_ROOT)
    .map((path) => ({ path, source: readFileSync(path, 'utf8') }))
    .filter(({ source }) => /method: '(POST|PUT|PATCH|DELETE)'/.test(source))

  it('finds the pages it is meant to be guarding', () => {
    // A restructure that empties this list would turn the suite into a silent pass.
    expect(pages.length).toBeGreaterThanOrEqual(8)
  })

  for (const { path, source } of pages) {
    const name = path.slice(path.indexOf('/backend/') + 1)

    it(`${name} takes the guard`, () => {
      const lines = source.split('\n')
      const mutating = /method: '(PUT|PATCH|DELETE)'/.test(source)
        || lines.some((line, index) => (
          line.includes("method: 'POST'")
          // The url sits a line or two above the method in every call in this module.
          && !READ_ONLY_POST.some((fragment) => lines.slice(Math.max(0, index - 3), index + 1).join(' ').includes(fragment))
        ))
      if (!mutating) return
      expect(source).toContain('useMarketingMutation(')
      expect(source).toContain('runMutation(')
    })
  }

  it('no page raises the conflict banner itself', () => {
    // `useGuardedMutation` calls `surfaceRecordConflict` on every failure. A page calling it too would raise
    // the same banner twice; the predicate is what a page needs to decide whether to add its own message.
    for (const { path, source } of pages) {
      expect([path, source.includes('surfaceRecordConflict(')]).toEqual([path, false])
    }
  })
})
