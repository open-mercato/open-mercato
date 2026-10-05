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
 * Two helpers satisfy it, both built on `useGuardedMutation`: `runMutation`, and `runLockedMutation` for a
 * write that also carries the record's expected version. The three side-panel editors use the second, which
 * is why the pattern below matches either — not a relaxation, since neither reaches the network without the
 * guard.
 *
 * READ-ONLY POSTs are exempt and named individually. Several endpoints in this module are queries that happen
 * to take a body — the audience estimate, the journey preview, the render, the AI draft, the delivery
 * explanation. Wrapping those would put a record-lock dialog in front of a question.
 */
const BACKEND_ROOT = join(__dirname, '..')

/**
 * Paths whose POST asks something rather than changes something.
 *
 * `/rescore` used to be on this list and is not a question: it applies the score rules and writes ledger
 * entries. It was exempted because it reads like a recalculation, which is exactly the kind of mistake a
 * named exemption list invites — every entry here has to be a POST that changes nothing at all.
 */
const READ_ONLY_POST = ['audience-estimate', '/preview', '/render', '/draft-copy', '/explain']

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

    /**
     * Every mutating call, not merely one somewhere in the file.
     *
     * The rule used to ask whether the source contained `runMutation(` at all, so a page with a guarded
     * delete and an unguarded create passed — which is what it did: creating a campaign, importing one and
     * starting from a template all went around the guard while the delete beside them went through it.
     */
    it(`${name} takes the guard on every write`, () => {
      const lines = source.split('\n')
      const unguarded: number[] = []

      lines.forEach((line, index) => {
        const method = /method: '(POST|PUT|PATCH|DELETE)'/.exec(line)
        if (!method) return
        // The url sits a line or two above the method in every call in this module.
        const call = lines.slice(Math.max(0, index - 3), index + 1).join(' ')
        if (method[1] === 'POST' && READ_ONLY_POST.some((fragment) => call.includes(fragment))) return
        /**
         * The guard wraps the call, so it sits a few lines above the method it is wrapping.
         *
         * Either helper counts and both go through `useGuardedMutation`: `runMutation` for a write with no
         * record version, `runLockedMutation` for one that also carries the expected `updatedAt`. Matched as
         * a whole word so a future `maybeRunMutation(` cannot satisfy this by accident.
         */
        const window = lines.slice(Math.max(0, index - 8), index + 1).join('\n')
        if (!/\brun(Locked)?Mutation\(/.test(window)) unguarded.push(index + 1)
      })

      // Named lines rather than a bare boolean: the failure has to say WHICH write slipped out.
      expect([name, unguarded]).toEqual([name, []])
      if (lines.some((line) => /method: '(POST|PUT|PATCH|DELETE)'/.test(line))) {
        expect(/\buse(Locked)?MarketingMutation\(/.test(source)).toBe(true)
      }
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
