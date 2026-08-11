/** @jest-environment node */
import fs from 'node:fs'
import path from 'node:path'

// P0-3..P0-6 invariants (spec 2026-07-12-ux-p0-hotfixes §3-§6): destructive
// deletes confirm before firing, the Processes stub actions stay honestly
// disabled, the Overview interventions section carries the shared Sample label,
// and the Caseload inbox exposes its loaded range. The module has no page-level
// RTL harness, so these are source+locale invariants (same style as
// process-definitions-route.test.ts).
describe('agent_orchestrator P0 honesty & safety invariants', () => {
  const moduleRoot = path.resolve(__dirname, '..')
  const read = (rel: string) => fs.readFileSync(path.join(moduleRoot, rel), 'utf8')
  const locales = ['en', 'es', 'de', 'pl'] as const
  const localeData = Object.fromEntries(
    locales.map((locale) => [locale, JSON.parse(read(`i18n/${locale}.json`)) as Record<string, string>]),
  )

  const NEW_KEYS = [
    'agent_orchestrator.caseload.inbox.range',
    'agent_orchestrator.common.sample',
    'agent_orchestrator.evalAssertions.confirmDelete.text',
    'agent_orchestrator.overview.interventions.sampleHint',
    'agent_orchestrator.process.actionsComingSoon',
    'agent_orchestrator.processDefinitions.confirmDelete.title',
    'agent_orchestrator.processDefinitions.confirmDelete.text',
  ]
  const REMOVED_KEYS = [
    'agent_orchestrator.process.actionPreviewOnly',
    'agent_orchestrator.traces.detail.sample',
    'agent_orchestrator.overview.domain',
    // Retired with the event-trigger table (triggered process model Phase 2):
    // removing a trigger is an unsaved draft edit, not a destructive delete.
    'agent_orchestrator.processDefinitions.triggers.confirmDelete.text',
  ]

  it.each(locales)('locale %s carries the new keys and drops the removed ones', (locale) => {
    const data = localeData[locale]
    for (const key of NEW_KEYS) expect(data[key]).toBeTruthy()
    for (const key of REMOVED_KEYS) expect(data[key]).toBeUndefined()
  })

  it('keeps {from}/{to}/{total} interpolations in every inbox range translation', () => {
    for (const locale of locales) {
      const value = localeData[locale]['agent_orchestrator.caseload.inbox.range']
      for (const token of ['{from}', '{to}', '{total}']) expect(value).toContain(token)
    }
  })

  it('confirms before deleting a process definition', () => {
    const source = read('backend/processes/definitions/page.tsx')
    expect(source).toContain("useConfirmDialog")
    const confirmIndex = source.indexOf("processDefinitions.confirmDelete.title")
    const deleteIndex = source.indexOf("deleteCrud('agent_orchestrator/process-definitions'")
    expect(confirmIndex).toBeGreaterThan(-1)
    expect(deleteIndex).toBeGreaterThan(confirmIndex)
  })

  it('edits triggers as a reviewable draft rather than a per-row destructive delete', () => {
    // Phase 2 of the triggered process model collapsed the event-trigger table
    // into the definition's `triggers` jsonb. Removing an entry is now an
    // unsaved edit to a draft list — reversible with Escape and only persisted
    // by an explicit, optimistic-locked save — so a delete confirmation would
    // be confirming nothing destructive.
    const source = read('backend/processes/definitions/[id]/page.tsx')
    expect(source).not.toContain('event-triggers/')
    expect(source).toContain('setTriggerDraft(task.triggers)')
    expect(source).toContain('buildOptimisticLockHeader(task.updatedAt)')
  })

  it('manages eval assertions through a guarded, non-destructive toggle (no per-agent raw delete)', () => {
    // The standalone eval-assertions list page (with its destructive delete row
    // action) was removed (2026-07-24 agent-centric-workspace-and-eval-consolidation);
    // assertions now live inside the agent Evaluation tab, where the reversible
    // enable/disable toggle — not a destructive delete — is the per-agent action,
    // and it runs through the guarded mutation pipeline. Deleting a shared ("*")
    // assertion from one agent's page is deliberately not exposed.
    expect(fs.existsSync(path.join(moduleRoot, 'backend/eval-assertions/page.tsx'))).toBe(false)
    const source = read('backend/agents/[id]/components/EvaluationTab.tsx')
    expect(source).toContain('runMutation')
    expect(source).not.toContain("deleteCrud('agent_orchestrator/eval-assertions'")
  })

  it('keeps the Processes case actions disabled with a caption instead of success flashes', () => {
    const source = read('backend/processes/[id]/page.tsx')
    expect(source).not.toContain('actionPreviewOnly')
    expect(source).toContain('agent_orchestrator.process.actionsComingSoon')
    // The three stub actions must stay disabled and handler-free. The block is
    // scoped to start at the FIRST stub (Pause) so real actions rendered before
    // it (e.g. the "Review in Caseload" CTA) are legitimately excluded.
    const actionsBlock = source.slice(
      source.indexOf('agent_orchestrator.process.actionPause') - 80,
      source.indexOf('agent_orchestrator.process.actionsComingSoon'),
    )
    expect(actionsBlock).toContain('disabled')
    expect(actionsBlock).not.toContain('onClick')
    for (const stub of ['actionPause', 'actionReassign', 'actionTakeOver']) {
      expect(actionsBlock).toContain(`agent_orchestrator.process.${stub}`)
    }
  })

  it('labels the Overview interventions section as sample data and drops the domain chip', () => {
    const source = read('backend/overview/page.tsx')
    expect(source).toContain('agent_orchestrator.common.sample')
    expect(source).toContain('agent_orchestrator.overview.interventions.sampleHint')
    expect(source).not.toContain('overview.domain')
  })

  it('shares the hoisted sample key with the trace inspector', () => {
    const source = read('backend/traces/[id]/page.tsx')
    expect(source).toContain('agent_orchestrator.common.sample')
    expect(source).not.toContain('agent_orchestrator.traces.detail.sample')
  })

  it('renders the inbox loaded-range label with pagination state', () => {
    const source = read('backend/caseload/page.tsx')
    expect(source).toContain('agent_orchestrator.caseload.inbox.range')
    expect(source).toContain("from '@open-mercato/ui/primitives/pagination'")
  })
})
