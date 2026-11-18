import {
  buildAuditEntryHref,
  buildProposalHref,
  buildRunTraceHref,
  isAuditEntryProposalVerified,
  readAuditEntryAnchors,
  readAuditEntryCorrelation,
} from '../lib/identity/auditEntryLinks'
import runLinkWidget from '../widgets/injection/audit-run-link/widget'
import proposalLinkWidget from '../widgets/injection/audit-proposal-link/widget'
import injectionTable from '../widgets/injection-table'

const RUN_ID = '22222222-2222-4222-8222-222222222222'
const PROPOSAL_ID = '33333333-3333-4333-8333-333333333333'

const INSTANCE_ID = '44444444-4444-4444-8444-444444444444'

function auditRow(correlation: unknown, proposalVerified?: boolean) {
  return {
    id: 'log-1',
    commandId: 'customers.deals.update',
    context: { source: 'agent', correlation },
    ...(proposalVerified === undefined ? {} : { _agent_orchestrator: { proposalVerified } }),
  }
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

describe('readAuditEntryAnchors', () => {
  it('keeps only uuid run, proposal and workflow instance ids', () => {
    expect(
      readAuditEntryAnchors(
        auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID, workflowInstanceId: INSTANCE_ID, agentId: 'x', other: 1 }),
      ),
    ).toEqual({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID, workflowInstanceId: INSTANCE_ID })
    expect(readAuditEntryAnchors(auditRow({ proposalId: 'not-a-uuid', workflowInstanceId: 7 }))).toEqual({})
    expect(readAuditEntryAnchors(null)).toEqual({})
  })
})

describe('isAuditEntryProposalVerified', () => {
  it('is true only for an explicit server-set true flag', () => {
    expect(isAuditEntryProposalVerified(auditRow({}, true))).toBe(true)
    expect(isAuditEntryProposalVerified(auditRow({}, false))).toBe(false)
    expect(isAuditEntryProposalVerified(auditRow({}))).toBe(false)
    expect(isAuditEntryProposalVerified({ _agent_orchestrator: { proposalVerified: 'true' } })).toBe(false)
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
    const proposalRow = auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID }, true)
    const humanRow = auditRow(undefined)
    expect(runAction.isVisible?.(agentRow)).toBe(true)
    expect(runAction.isVisible?.(humanRow)).toBe(false)
    expect(proposalAction.isVisible?.(agentRow)).toBe(false)
    expect(proposalAction.isVisible?.(proposalRow)).toBe(true)
  })

  it('hide the proposal link when the server did not verify the proposal id', () => {
    const navigate = jest.fn()
    const forged = auditRow({ proposalId: PROPOSAL_ID, workflowInstanceId: INSTANCE_ID }, false)
    const unenriched = auditRow({ proposalId: PROPOSAL_ID, workflowInstanceId: INSTANCE_ID })
    expect(proposalAction.isVisible?.(forged)).toBe(false)
    expect(proposalAction.isVisible?.(unenriched)).toBe(false)
    proposalAction.onSelect(forged, { navigate })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigate to the run trace and the proposal', () => {
    const navigate = jest.fn()
    const row = auditRow({ agentRunId: RUN_ID, proposalId: PROPOSAL_ID }, true)
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
