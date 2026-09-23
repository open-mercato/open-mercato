/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'

// Phase-4 invariants of the data-honesty spec
// (2026-07-12-ux-data-honesty-pass §3.4-§3.5): the Overview window picker is a
// real, URL-persisted select wired to both metrics endpoints; "refreshed just
// now" is a computed relative time; a failed or forbidden panel fetch never
// renders as an all-clear empty state. The module has no page-level RTL
// harness, so these are source+locale invariants (p0-honesty-safety.test.ts
// style).
describe('agent_orchestrator overview honesty invariants (spec 3 phase 4)', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const locales = ['en', 'es', 'de', 'pl'] as const
  const localeData = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>]),
  )
  const overviewSource = read('backend/overview/page.tsx')

  const NEW_KEYS = [
    'agent_orchestrator.overview.panel.error',
    'agent_orchestrator.overview.panel.forbidden',
    'agent_orchestrator.overview.panel.retry',
    'agent_orchestrator.overview.refreshedAt',
    'agent_orchestrator.overview.refreshedJustNow',
    'agent_orchestrator.overview.window.d30',
    'agent_orchestrator.overview.window.d7',
    'agent_orchestrator.overview.window.h24',
    'agent_orchestrator.overview.window.now',
    'agent_orchestrator.overview.window.select',
  ]
  const REMOVED_KEYS = [
    'agent_orchestrator.overview.period.thisWeek',
    'agent_orchestrator.overview.period.week',
    'agent_orchestrator.overview.refreshed',
  ]

  it.each(locales)('locale %s carries the new window/panel keys and drops the removed ones', (locale) => {
    const data = localeData[locale]
    for (const key of NEW_KEYS) expect(data[key]).toBeTruthy()
    for (const key of REMOVED_KEYS) expect(data[key]).toBeUndefined()
  })

  it('interpolates {time} in every refreshedAt translation', () => {
    for (const locale of locales) {
      expect(localeData[locale]['agent_orchestrator.overview.refreshedAt']).toContain('{time}')
    }
  })

  it('replaces the static refreshed copy and the dead window button', () => {
    expect(overviewSource).not.toContain('overview.refreshed\'')
    expect(overviewSource).not.toContain('period.thisWeek')
    expect(overviewSource).not.toContain('period.week')
    // The old dead button flashed "Needs backend" on click; the picker must not.
    expect(overviewSource).not.toMatch(/onClick=\{\(\) => flash\(/)
    expect(overviewSource).toContain('overview.refreshedJustNow')
    expect(overviewSource).toContain('overview.refreshedAt')
  })

  it('wires a URL-persisted window param into both metrics endpoints', () => {
    expect(overviewSource).toContain('useSearchParams')
    expect(overviewSource).toContain("windowKeyFrom(searchParams?.get('window')")
    expect(overviewSource).toContain('/backend/overview?window=${next}')
    expect(overviewSource).toContain('metrics/overview?window=${windowKey}')
    expect(overviewSource).toContain('metrics/agents?window=${windowKey}')
  })

  it('never renders panel empty states over a failed or forbidden fetch', () => {
    // fetchList is discriminated and 403 maps to a dedicated state.
    expect(overviewSource).toContain('{ ok: false; status: number }')
    expect(overviewSource).toContain("res.status === 403 ? 'forbidden' : 'error'")
    // The guard must run BEFORE the empty-state branch for both panels.
    const stuckGuard = overviewSource.indexOf("pendingState !== 'ok'")
    const stuckEmpty = overviewSource.indexOf('overview.stuck.empty')
    expect(stuckGuard).toBeGreaterThan(-1)
    expect(stuckGuard).toBeLessThan(stuckEmpty)
    const trustGuard = overviewSource.indexOf("trustState !== 'ok'")
    const trustEmpty = overviewSource.indexOf('overview.trust.empty')
    expect(trustGuard).toBeGreaterThan(-1)
    expect(trustGuard).toBeLessThan(trustEmpty)
    // Both failure branches render the shared PanelNote (forbidden note / retry).
    expect(overviewSource).toContain('<PanelNote state={pendingState}')
    expect(overviewSource).toContain('<PanelNote state={trustState}')
    expect(overviewSource).toContain('overview.panel.retry')
  })

  it('captions windowed vs current-state tiles distinctly', () => {
    expect(overviewSource).toContain('caption={windowLabel}')
    expect(overviewSource).toContain("caption={t('agent_orchestrator.overview.window.now'")
  })
})
