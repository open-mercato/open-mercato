import { eventsConfig } from '../events'
import {
  emitRunReviewRequested,
  resolveInteractiveInvokerUserId,
} from '../lib/guardrails/integrity/reviewRequestedEvent'

describe('resolveInteractiveInvokerUserId', () => {
  it('addresses a user who started the run in person', () => {
    expect(resolveInteractiveInvokerUserId({ userId: 'u-1', invoker: { kind: 'user', userId: 'u-2' } })).toBe('u-2')
    expect(resolveInteractiveInvokerUserId({ userId: 'u-1' })).toBe('u-1')
  })

  it('treats workflow, API-key and agent-token runs as unattended', () => {
    expect(resolveInteractiveInvokerUserId({ userId: 'u-1', invoker: { kind: 'workflow', actingUserId: 'u-1' } })).toBeNull()
    expect(
      resolveInteractiveInvokerUserId({ userId: 'u-1', invoker: { kind: 'api_key', apiKeyId: 'k-1', ownerUserId: 'u-1' } }),
    ).toBeNull()
    expect(
      resolveInteractiveInvokerUserId({
        userId: 'u-1',
        invoker: { kind: 'agent_token', agentUserId: 'a-1', onBehalfOfUserId: 'u-1', grantId: 'g-1' },
      }),
    ).toBeNull()
    expect(resolveInteractiveInvokerUserId({ userId: 'u-1', workflowInstanceId: 'wf-1' })).toBeNull()
    expect(resolveInteractiveInvokerUserId({ userId: '  ' })).toBeNull()
  })
})

const base = {
  agentRunId: 'run-1',
  agentId: 'demo.agent',
  tenantId: 'tenant-1',
  organizationId: 'org-1',
}

describe('run.review_requested', () => {
  it('is declared as a server-side lifecycle event, never broadcast to browsers', () => {
    const event = eventsConfig.events.find((entry) => entry.id === 'agent_orchestrator.run.review_requested')
    expect(event).toMatchObject({ entity: 'run', category: 'lifecycle' })
    expect(event?.clientBroadcast).not.toBe(true)
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

  it('carries the interactive invoker only when one is given', async () => {
    const emit = jest.fn().mockResolvedValue(undefined)
    await emitRunReviewRequested(
      { ...base, invokedByUserId: 'user-7', reviewRequest: { ruleId: 'rule-1', route: 'review', reasons: [] } },
      emit,
    )
    await emitRunReviewRequested(
      { ...base, invokedByUserId: null, reviewRequest: { ruleId: 'rule-1', route: 'review', reasons: [] } },
      emit,
    )
    expect(emit.mock.calls[0][1]).toMatchObject({ invokedByUserId: 'user-7' })
    expect(emit.mock.calls[1][1]).not.toHaveProperty('invokedByUserId')
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
