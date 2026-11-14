import { eventsConfig } from '../events'
import { emitRunReviewRequested } from '../lib/guardrails/integrity/reviewRequestedEvent'

const base = {
  agentRunId: 'run-1',
  agentId: 'demo.agent',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

describe('run.review_requested', () => {
  it('is declared as a broadcast lifecycle event', () => {
    const event = eventsConfig.events.find((entry) => entry.id === 'agent_orchestrator.run.review_requested')
    expect(event).toMatchObject({ entity: 'run', category: 'lifecycle', clientBroadcast: true })
  })

  it('emits a persistent event for the review route', async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    const emitted = await emitRunReviewRequested(
      {
        ...base,
        workflowInstanceId: 'wf-1',
        reviewRequest: { ruleId: 'rule-1', route: 'review', reasons: ['low_confidence'] },
      },
      emit,
    )
    expect(emitted).toBe(true)
    expect(emit).toHaveBeenCalledWith(
      'agent_orchestrator.run.review_requested',
      {
        agentRunId: 'run-1',
        agentId: 'demo.agent',
        ruleId: 'rule-1',
        reasons: ['low_confidence'],
        workflowInstanceId: 'wf-1',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
      { persistent: true },
    )
  })

  it('omits workflowInstanceId when absent', async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    await emitRunReviewRequested(
      { ...base, reviewRequest: { ruleId: 'rule-1', route: 'review', reasons: [] } },
      emit,
    )
    expect(emit.mock.calls[0][1]).not.toHaveProperty('workflowInstanceId')
  })

  it('does not emit for flag route or absent review request', async () => {
    const emit = jest.fn()
    expect(
      await emitRunReviewRequested(
        { ...base, reviewRequest: { ruleId: 'rule-1', route: 'flag', reasons: ['x'] } },
        emit,
      ),
    ).toBe(false)
    expect(await emitRunReviewRequested({ ...base, reviewRequest: undefined }, emit)).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('never throws when the emit fails', async () => {
    const emit = jest.fn().mockRejectedValue(new Error('bus down'))
    await expect(
      emitRunReviewRequested(
        { ...base, reviewRequest: { ruleId: 'rule-1', route: 'review', reasons: [] } },
        emit,
      ),
    ).resolves.toBe(false)
  })
})
