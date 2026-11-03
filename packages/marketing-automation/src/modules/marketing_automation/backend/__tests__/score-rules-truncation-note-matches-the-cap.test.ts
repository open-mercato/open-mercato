import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The score-rules screen's truncation note has to say the same number the engine actually evaluates.
 *
 * `MAX_EVALUATED_SCORE_RULES` (`lib/score-rules.ts`) is what `loadScoreRules` caps at; the screen holds its
 * own copy of that number rather than importing the server-only file into a "use client" bundle. A copy
 * drifting from the original is exactly how the note used to lie: it said "only the first {count} rules are
 * listed and evaluated" with `{count}` being the PAGE size (100), not the evaluation cap (200) — the note
 * also claimed "listed" and "evaluated" were the same number when the screen had no way to list past the
 * first page at all.
 */
const LIB_SOURCE = readFileSync(
  join(__dirname, '..', '..', 'lib', 'score-rules.ts'),
  'utf8',
)
const PAGE_SOURCE = readFileSync(
  join(__dirname, '..', 'marketing', 'score-rules', 'page.tsx'),
  'utf8',
)

function constantValue(source: string, name: string): number {
  const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`))
  if (!match) throw new Error(`${name} not found`)
  return Number(match[1])
}

describe('the score-rules screen mirrors the engine\'s evaluation cap', () => {
  it('MAX_EVALUATED_RULES on the screen equals MAX_EVALUATED_SCORE_RULES in the engine', () => {
    const engineCap = constantValue(LIB_SOURCE, 'MAX_EVALUATED_SCORE_RULES')
    const screenCap = constantValue(PAGE_SOURCE, 'MAX_EVALUATED_RULES')
    expect(screenCap).toBe(engineCap)
  })

  it('the truncation note is driven by that constant, not by the page size or the current page\'s row count', () => {
    const truncatedBlock = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf('const truncated ='))
    expect(truncatedBlock.slice(0, 120)).toContain('MAX_EVALUATED_RULES')
    expect(PAGE_SOURCE).not.toMatch(/truncated.*rows\.length/)
  })

  it('the screen can page past its own page size', () => {
    expect(PAGE_SOURCE).toMatch(/onPageChange/)
  })
})
