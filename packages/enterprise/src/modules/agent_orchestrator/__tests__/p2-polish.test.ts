/**
 * Phase-6 (P2 polish) source + locale invariants — consistency-pass spec
 * (2026-07-12-ux-consistency-pass.md, Area 8). Follows the module's
 * source-invariant test style (p0-honesty-safety precedent).
 */
import * as fs from 'node:fs'
import * as path from 'node:path'

const MODULE_ROOT = path.resolve(__dirname, '..')
const LOCALES = ['en', 'pl', 'de', 'es'] as const

function readSource(relPath: string): string {
  return fs.readFileSync(path.join(MODULE_ROOT, relPath), 'utf8')
}

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(MODULE_ROOT, 'i18n', `${locale}.json`), 'utf8'))
}

describe('P2 polish — plurals', () => {
  it.each(LOCALES)('%s: reject dialog has singular + plural keys without "(s)" hacks', (locale) => {
    const catalog = readLocale(locale)
    const plural = catalog['agent_orchestrator.caseload.reject.description']
    const singular = catalog['agent_orchestrator.caseload.reject.descriptionOne']
    expect(plural).toContain('{count}')
    expect(plural).not.toMatch(/\(s\)|\(i\)|\(e\)/)
    expect(singular).toBeTruthy()
    expect(singular).not.toContain('{count}')
  })

  it('caseload picks the singular key for a single rejection', () => {
    const source = readSource('backend/caseload/page.tsx')
    expect(source).toContain("t('agent_orchestrator.caseload.reject.descriptionOne')")
    expect(source).toMatch(/rejectPendingCount === 1/)
  })

  it.each(LOCALES)('%s: reasoning hint cannot render "1 steps"', (locale) => {
    const catalog = readLocale(locale)
    const hint = catalog['agent_orchestrator.traces.detail.reasoningHint']
    expect(hint).toContain('{count}')
    // Label-style phrasing ("Steps: {count}") — the count never prefixes a plural noun.
    expect(hint).not.toMatch(/^\{count\}\s/)
  })
})

describe('P2 polish — trace inspector display', () => {
  const tracePage = readSource('backend/traces/[id]/page.tsx')

  it('artifact expander offers collapse after loading', () => {
    expect(tracePage).toContain("t('agent_orchestrator.traces.detail.collapseArtifact')")
    expect(tracePage).toMatch(/setFull\(undefined\)/)
  })

  it('object summaries render via JsonDisplay (copy affordance)', () => {
    expect(tracePage).toContain('function SummaryDisplay')
    expect(tracePage).toContain('<SummaryDisplay value={toolCall.requestSummary} />')
    expect(tracePage).toContain('<SummaryDisplay value={toolCall.responseSummary} />')
  })

  it('timeline renders the span-kind legend', () => {
    expect(tracePage).toContain("t('agent_orchestrator.traces.detail.legend.llm')")
    expect(tracePage).toContain("t('agent_orchestrator.traces.detail.legend.tool')")
  })

  it('tool and guardrail accordions expose aria-expanded', () => {
    expect(tracePage).toMatch(/aria-expanded=\{open\}/)
    expect(tracePage).toMatch(/aria-expanded=\{expandable \? open : undefined\}/)
  })

  it.each(LOCALES)('%s: new trace keys present', (locale) => {
    const catalog = readLocale(locale)
    expect(catalog['agent_orchestrator.traces.detail.collapseArtifact']).toBeTruthy()
    expect(catalog['agent_orchestrator.traces.detail.legend.llm']).toBeTruthy()
    expect(catalog['agent_orchestrator.traces.detail.legend.tool']).toBeTruthy()
  })
})

describe('P2 polish — processes', () => {
  it('active facet gets its own empty copy', () => {
    const source = readSource('backend/processes/page.tsx')
    expect(source).toContain("t('agent_orchestrator.process.list.facetEmpty')")
    expect(source).toMatch(/facet !== 'all'/)
  })

  it('detail defaults to the first pending step, else the newest', () => {
    const source = readSource('backend/processes/[id]/page.tsx')
    expect(source).toContain("steps.find((step) => step.disposition === 'pending')")
    expect(source).toContain('steps[steps.length - 1]')
  })

  it('terminal processes render an all-done stepper', () => {
    const source = readSource('backend/processes/[id]/page.tsx')
    expect(source).toMatch(/\['auto_completed', 'completed', 'failed', 'cancelled'\]\.includes\(process\.status\)/)
  })

  it.each(LOCALES)('%s: facetEmpty key present', (locale) => {
    expect(readLocale(locale)['agent_orchestrator.process.list.facetEmpty']).toBeTruthy()
  })
})

describe('P2 polish — playground input reset', () => {
  it('switching agents clears the input and re-offers the sample', () => {
    const source = readSource('backend/playground/page.tsx')
    expect(source).toMatch(/setAgentId\(nextId\)/)
    expect(source).toMatch(/nextSample !== undefined \? JSON\.stringify\(nextSample, null, 2\)/)
  })
})

describe('P2 polish — a11y', () => {
  it('overview stuck + trust rows are keyboard-operable links', () => {
    const source = readSource('backend/overview/page.tsx')
    const roleLinks = source.match(/role="link"/g) ?? []
    expect(roleLinks.length).toBeGreaterThanOrEqual(2)
    expect(source).toContain("t('agent_orchestrator.overview.stuck.openRow'")
    expect(source).toContain("t('agent_orchestrator.overview.trust.openRow'")
    expect(source).toMatch(/event\.key === 'Enter' \|\| event\.key === ' '/)
  })

  it('traces and processes facet tabs carry tablist/tab semantics', () => {
    for (const page of ['backend/traces/page.tsx', 'backend/processes/page.tsx']) {
      const source = readSource(page)
      expect(source).toContain('role="tablist"')
      expect(source).toContain('role="tab"')
      expect(source).toContain('aria-selected={active}')
    }
  })

  it.each(LOCALES)('%s: openRow aria labels present with {id}', (locale) => {
    const catalog = readLocale(locale)
    expect(catalog['agent_orchestrator.overview.stuck.openRow']).toContain('{id}')
    expect(catalog['agent_orchestrator.overview.trust.openRow']).toContain('{id}')
  })
})
