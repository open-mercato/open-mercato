import {
  getAmbientAuditCorrelation,
  withAuditCorrelation,
} from '@open-mercato/shared/lib/commands/auditCorrelationScope'

describe('auditCorrelationScope', () => {
  it('returns null outside any scope', () => {
    expect(getAmbientAuditCorrelation()).toBeNull()
  })

  it('exposes the correlation inside a scope and across awaits', async () => {
    const seen = await withAuditCorrelation({ agentRunId: 'run-1' }, async () => {
      await new Promise((resolve) => setTimeout(resolve, 1))
      return getAmbientAuditCorrelation()
    })
    expect(seen).toEqual({ agentRunId: 'run-1' })
    expect(getAmbientAuditCorrelation()).toBeNull()
  })

  it('merges nested scopes with the inner scope winning for the same key', () => {
    const seen = withAuditCorrelation({ agentRunId: 'outer', workflowInstanceId: 'wf-1' }, () =>
      withAuditCorrelation({ agentRunId: 'inner', proposalId: 'prop-1' }, () => getAmbientAuditCorrelation()),
    )
    expect(seen).toEqual({ agentRunId: 'inner', workflowInstanceId: 'wf-1', proposalId: 'prop-1' })
  })

  it('restores the outer correlation after a nested scope ends', () => {
    const seen = withAuditCorrelation({ agentRunId: 'outer' }, () => {
      withAuditCorrelation({ agentRunId: 'inner' }, () => undefined)
      return getAmbientAuditCorrelation()
    })
    expect(seen).toEqual({ agentRunId: 'outer' })
  })

  it('drops empty and non-string values', () => {
    const correlation = { agentRunId: 'run-1', empty: '', count: 3 } as unknown as Record<string, string>
    const seen = withAuditCorrelation(correlation, () => getAmbientAuditCorrelation())
    expect(seen).toEqual({ agentRunId: 'run-1' })
  })

  it('returns a copy that callers cannot use to mutate the scope', () => {
    withAuditCorrelation({ agentRunId: 'run-1' }, () => {
      const first = getAmbientAuditCorrelation()
      if (first) first.agentRunId = 'tampered'
      expect(getAmbientAuditCorrelation()).toEqual({ agentRunId: 'run-1' })
    })
  })
})
