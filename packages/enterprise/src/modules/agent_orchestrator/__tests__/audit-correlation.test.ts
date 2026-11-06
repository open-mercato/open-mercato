import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { buildRunAuditCorrelation, withRunAuditCorrelation } from '../lib/runtime/persistence'
import {
  buildProposalAuditCorrelation,
  withProposalAuditCorrelation,
} from '../lib/disposition/proposalAuditCorrelation'

const baseRunCtx = { tenantId: 'tenant-1', organizationId: 'org-1', userId: 'user-1' }

describe('run audit correlation', () => {
  it('stamps only the run id when the context carries nothing else', () => {
    expect(buildRunAuditCorrelation(baseRunCtx, 'run-1')).toEqual({ agentRunId: 'run-1' })
  })

  it('stamps the grant id for an agent-token invoker and never the user ids', () => {
    expect(
      buildRunAuditCorrelation(
        {
          ...baseRunCtx,
          invoker: { kind: 'agent_token', agentUserId: 'agent-user-1', onBehalfOfUserId: 'user-1', grantId: 'grant-1' },
        },
        'run-1',
      ),
    ).toEqual({ agentRunId: 'run-1', grantId: 'grant-1' })
  })

  it('stamps no invoker id for a user or workflow invoker', () => {
    expect(
      buildRunAuditCorrelation({ ...baseRunCtx, invoker: { kind: 'workflow', actingUserId: 'user-1' } }, 'run-1'),
    ).toEqual({ agentRunId: 'run-1' })
  })

  it('keeps correlation already on the command context and leaves the rest of it intact', () => {
    const commandCtx = {
      selectedOrganizationId: 'org-1',
      auditCorrelation: { requestId: 'request-1' },
    } as unknown as CommandRuntimeContext
    const stamped = withRunAuditCorrelation(commandCtx, baseRunCtx, 'run-1')
    expect(stamped.selectedOrganizationId).toBe('org-1')
    expect(stamped.auditCorrelation).toEqual({ requestId: 'request-1', agentRunId: 'run-1' })
    expect(commandCtx.auditCorrelation).toEqual({ requestId: 'request-1' })
  })
})

describe('proposal audit correlation', () => {
  it('stamps the proposal and its run', () => {
    expect(buildProposalAuditCorrelation({ id: 'proposal-1', runId: 'run-1' })).toEqual({
      proposalId: 'proposal-1',
      agentRunId: 'run-1',
    })
  })

  it('omits the run id when the proposal has none', () => {
    expect(buildProposalAuditCorrelation({ id: 'proposal-1', runId: null })).toEqual({ proposalId: 'proposal-1' })
  })

  it('merges into the correlation already on the command context', () => {
    const commandCtx = { auditCorrelation: { proposalId: 'proposal-1' } } as unknown as CommandRuntimeContext
    expect(withProposalAuditCorrelation(commandCtx, { id: 'proposal-1', runId: 'run-1' }).auditCorrelation).toEqual({
      proposalId: 'proposal-1',
      agentRunId: 'run-1',
    })
  })
})
