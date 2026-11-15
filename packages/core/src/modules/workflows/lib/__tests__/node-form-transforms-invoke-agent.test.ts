import type { Node } from '@xyflow/react'
import { nodeToFormValues, formValuesToNodeUpdates, type NodeFormValues } from '../nodeFormTransforms'

function makeNode(data: Record<string, unknown>): Node {
  return {
    id: 'step_klient',
    type: 'invokeAgent',
    position: { x: 0, y: 0 },
    data,
  } as unknown as Node
}

describe('nodeFormTransforms — invokeAgent', () => {
  test('reads agent config off the INVOKE_AGENT activity', () => {
    const node = makeNode({
      stepName: 'Klient',
      activities: [
        {
          activityId: 'invoke_agent',
          activityName: 'Invoke Agent',
          activityType: 'INVOKE_AGENT',
          config: {
            agentId: 'client_profile',
            input: { dealId: '{{deal.id}}', notes: { nested: true } },
            onResult: { alwaysAsk: true },
            outputMapping: { riskScore: 'proposalPayload.riskScore' },
          },
        },
      ],
    })

    const values = nodeToFormValues(node)

    expect(values.agentConfig).toEqual({
      agentId: 'client_profile',
      inputs: [
        { key: 'dealId', value: '{{deal.id}}' },
        { key: 'notes', value: '{"nested":true}' },
      ],
      resultMode: 'alwaysAsk',
      autoApproveThreshold: '0.8',
      outputs: [{ key: 'riskScore', value: 'proposalPayload.riskScore' }],
      subject: { subjectType: '', subjectId: '', subjectLabel: '' },
    })
  })

  test('falls back to editable defaults for a freshly dropped step', () => {
    const values = nodeToFormValues(makeNode({ stepName: 'Klient' }))

    expect(values.agentConfig).toEqual({
      agentId: '',
      inputs: [{ key: 'dealId', value: '{{deal.id}}' }],
      resultMode: 'autoApprove',
      autoApproveThreshold: '0.8',
      outputs: [],
      subject: { subjectType: '', subjectId: '', subjectLabel: '' },
    })
  })

  test('compiles form values back into a single INVOKE_AGENT activity', () => {
    const node = makeNode({ stepName: 'Klient' })
    const values: NodeFormValues = {
      stepName: 'Klient',
      agentConfig: {
        agentId: 'client_profile',
        inputs: [
          { key: 'dealId', value: '{{deal.id}}' },
          { key: '  ', value: 'dropped' },
        ],
        resultMode: 'autoApprove',
        autoApproveThreshold: '0.75',
        outputs: [{ key: 'riskScore', value: 'proposalPayload.riskScore' }],
      },
    }

    const updates = formValuesToNodeUpdates(values, node) as any

    expect(updates.agentId).toBe('client_profile')
    expect(updates.signalConfig).toEqual({ signalName: 'agent_orchestrator.proposal.ready' })
    expect(updates.activities).toEqual([
      {
        activityId: 'invoke_agent',
        activityName: 'Invoke Agent',
        activityType: 'INVOKE_AGENT',
        config: {
          agentId: 'client_profile',
          input: { dealId: '{{deal.id}}' },
          // The near-tie margin is opt-in: 0 is the schema default and preserves
          // the node's existing auto-approve behaviour exactly.
          onResult: { autoApproveThreshold: 0.75, autoApproveMargin: 0 },
          outputMapping: { riskScore: 'proposalPayload.riskScore' },
        },
      },
    ])
  })

  test('omits outputMapping when no rows are configured and preserves unexposed config', () => {
    const node = makeNode({
      stepName: 'Klient',
      activities: [
        {
          activityId: 'agent_step',
          activityName: 'Client profile',
          activityType: 'INVOKE_AGENT',
          config: {
            agentId: 'client_profile',
            input: {},
            onResult: { alwaysAsk: true },
            outputMapping: { riskScore: 'proposalPayload.riskScore' },
            subject: { type: 'deal', id: '{{deal.id}}' },
          },
        },
      ],
    })

    const updates = formValuesToNodeUpdates(
      {
        stepName: 'Klient',
        agentConfig: {
          agentId: 'client_profile',
          inputs: [],
          resultMode: 'alwaysAsk',
          autoApproveThreshold: '0.8',
          outputs: [],
        },
      },
      node,
    ) as any

    const config = updates.activities[0].config
    expect(config).not.toHaveProperty('outputMapping')
    expect(config.subject).toEqual({ type: 'deal', id: '{{deal.id}}' })
    expect(config.onResult).toEqual({ alwaysAsk: true })
    expect(updates.activities[0].activityId).toBe('agent_step')
    expect(updates.activities[0].activityName).toBe('Client profile')
  })

  test('round-trips the edited subject keys and keeps the rest of the descriptor', () => {
    const node = makeNode({
      stepName: 'Klient',
      activities: [
        {
          activityId: 'agent_step',
          activityName: 'Client profile',
          activityType: 'INVOKE_AGENT',
          config: {
            agentId: 'client_profile',
            input: {},
            onResult: { alwaysAsk: true },
            subject: { subjectType: 'claim', subjectId: '{{context.orderId}}', valueMinor: 1200 },
          },
        },
      ],
    })

    const values = nodeToFormValues(node)
    expect(values.agentConfig?.subject).toEqual({
      subjectType: 'claim',
      subjectId: '{{context.orderId}}',
      subjectLabel: '',
    })

    const updates = formValuesToNodeUpdates(
      {
        stepName: 'Klient',
        agentConfig: {
          agentId: 'client_profile',
          inputs: [],
          resultMode: 'alwaysAsk',
          autoApproveThreshold: '0.8',
          outputs: [],
          subject: { subjectType: 'claim', subjectId: '{{context.orderId}}', subjectLabel: 'Claim #1' },
        },
      },
      node,
    ) as any

    expect(updates.activities[0].config.subject).toEqual({
      subjectType: 'claim',
      subjectId: '{{context.orderId}}',
      subjectLabel: 'Claim #1',
      valueMinor: 1200,
    })
  })

  test('drops an emptied subject instead of persisting blank keys', () => {
    const node = makeNode({
      stepName: 'Klient',
      activities: [
        {
          activityId: 'agent_step',
          activityName: 'Client profile',
          activityType: 'INVOKE_AGENT',
          config: {
            agentId: 'client_profile',
            input: {},
            onResult: { alwaysAsk: true },
            subject: { subjectType: 'claim' },
          },
        },
      ],
    })

    const updates = formValuesToNodeUpdates(
      {
        stepName: 'Klient',
        agentConfig: {
          agentId: 'client_profile',
          inputs: [],
          resultMode: 'alwaysAsk',
          autoApproveThreshold: '0.8',
          outputs: [],
          subject: { subjectType: '', subjectId: '', subjectLabel: '' },
        },
      },
      node,
    ) as any

    expect(updates.activities[0].config).not.toHaveProperty('subject')
  })
})
