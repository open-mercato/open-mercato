import {
  buildAuditEntryHref,
  buildProposalHref,
  buildRunTraceHref,
  readAuditEntryCorrelation,
} from '../lib/identity/auditEntryLinks'
import runLinkWidget from '../widgets/injection/audit-run-link/widget'
import proposalLinkWidget from '../widgets/injection/audit-proposal-link/widget'
import injectionTable from '../widgets/injection-table'

const RUN_ID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'

function auditRow(correlation: unknown) {
  return { id: 'log-1', commandId: 'customers.deals.update', context: { source: 'agent', correlation } }
}

describe('readAuditEntryCorrelation', () => {
  it('reads the run and proposal ids from context.correlation', () => {
    expect(readAuditEntryCorrelation(auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID }))).toEqual({
      agentRunId: RUN_ID,
      proposalId: PROPOSAL_ID,
    })
  })

  it('ignores non-uuid values and rows without a correlation', () => {
    expect(readAuditEntryCorrelation(auditRow({ agentRunId: '../../settings', proposalId: 42 }))).toEqual({
      agentRunId: null,
      proposalId: null,
    })
    expect(readAuditEntryCorrelation({ id: 'log-2', context: null })).toEqual({ agentRunId: null, proposalId: null })
    expect(readAuditEntryCorrelation(null)).toEqual({ agentRunId: null, proposalId: null })
  })
})

describe('audit link hrefs', () => {
  it('points at the trace, the caseload proposal and the audit entry', () => {
    expect(buildRunTraceHref(RUN_ID)).toBe(`/backend/traces/${RUN_ID}`)
    expect(buildProposalHref(PROPOSAL_ID)).toBe(`/backend/caseload/${PROPOSAL_ID}`)
    expect(buildAuditEntryHref('log 1')).toBe('/backend/audit-logs?logId=log%201')
  })
})

describe('audit table row-action widgets', () => {
  const runAction = runLinkWidget.rowActions[0]
  const proposalAction = proposalLinkWidget.rowActions[0]

  it('are registered on the audit actions table row-actions spot', () => {
    const entries = injectionTable['data-table:audit_logs.actions.list:row-actions']
    expect(Array.isArray(entries) ? entries.map((entry) => (typeof entry === 'string' ? entry : entry.widgetId)) : entries).toEqual([
      runLinkWidget.metadata.id,
      proposalLinkWidget.metadata.id,
    ])
  })

  it('gate the run and proposal links on their own features', () => {
    expect(runLinkWidget.metadata.features).toEqual(['agent_orchestrator.trace.view'])
    expect(proposalLinkWidget.metadata.features).toEqual(['agent_orchestrator.proposals.view'])
  })

  it('show only on rows carrying the matching correlation', () => {
    const agentRow = auditRow({ agentRunId: RUN_ID })
    const proposalRow = auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID })
    const humanRow = auditRow(undefined)
    expect(runAction.isVisible?.(agentRow)).toBe(true)
    expect(runAction.isVisible?.(humanRow)).toBe(false)
    expect(proposalAction.isVisible?.(agentRow)).toBe(false)
    expect(proposalAction.isVisible?.(proposalRow)).toBe(true)
  })

  it('navigate to the run trace and the proposal', () => {
    const navigate = jest.fn()
    const row = auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID })
    runAction.onSelect(row, { navigate })
    proposalAction.onSelect(row, { navigate })
    expect(navigate.mock.calls).toEqual([[`/backend/traces/${RUN_ID}`], [`/backend/caseload/${PROPOSAL_ID}`]])
  })

  it('do nothing for a row without a correlation', () => {
    const navigate = jest.fn()
    runAction.onSelect(auditRow(undefined), { navigate })
    proposalAction.onSelect(auditRow(undefined), { navigate })
    expect(navigate).not.toHaveBeenCalled()
  })
})
