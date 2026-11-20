import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The jobs screen's "stopped at the limit" badge has to actually be wired to the `truncated`
 * counter a capped bulk action or export writes (`workers/segment-action.ts`), not just exist as
 * dead markup. A render test would need this module's first React-render harness; this asserts
 * the same contract the way the module's other screen-logic tests do — against the source —
 * consistent with `score-rules-truncation-note-matches-the-cap.test.ts` next to it.
 */
const PAGE_SOURCE = readFileSync(join(__dirname, '..', 'marketing', 'jobs', 'page.tsx'), 'utf8')

describe('the jobs screen flags a truncated result', () => {
  it('destructures `truncated` off the counters rather than reading a differently-named field', () => {
    expect(PAGE_SOURCE).toMatch(/const\s*\{\s*truncated\s*,\s*\.\.\.rest\s*\}\s*=\s*counters/)
  })

  it('renders the warning badge only when truncated is set, not unconditionally', () => {
    const cellBody = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("id: 'counters'"), PAGE_SOURCE.indexOf("id: 'campaign'"))
    expect(cellBody).toMatch(/Boolean\(truncated\)\s*&&/)
    expect(cellBody).toContain('variant="warning"')
    expect(cellBody).toContain('marketing_automation.jobs.counter.truncated')
  })

  it('the badge copy key resolves to a real, non-empty label in the shipped locale', () => {
    const en = JSON.parse(
      readFileSync(join(__dirname, '..', '..', 'i18n', 'en.json'), 'utf8'),
    ) as Record<string, string>
    const label = en['marketing_automation.jobs.counter.truncated']
    expect(typeof label).toBe('string')
    expect(label.trim().length).toBeGreaterThan(0)
  })
})
