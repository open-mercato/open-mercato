import type { WorkflowDefinitionData } from '../../data/entities'
import { evaluateWorkflowDefinition } from '../definition-evaluation'
import {
  collectUnsafeMappingTargetIssues,
  UNSAFE_MAPPING_TARGET_MESSAGE,
} from '../mapping-target-validation'

function definitionWithMappings(): WorkflowDefinitionData {
  return {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'sub',
        stepName: 'Sub-workflow',
        stepType: 'SUB_WORKFLOW',
        config: {
          subWorkflowId: 'child',
          inputMapping: JSON.parse('{"__proto__.polluted":"payload.constructor.value"}'),
          outputMapping: { safe: 'result.prototype.value' },
        },
        activities: [
          {
            activityId: 'agent',
            activityName: 'Agent',
            activityType: 'INVOKE_AGENT',
            config: {
              agentId: 'reviewer',
              onResult: { alwaysAsk: true },
              outputMapping: JSON.parse('{"constructor.value":"proposalPayload.constructor.value"}'),
            },
          },
        ],
      },
      {
        stepId: 'join',
        stepName: 'Join',
        stepType: 'PARALLEL_JOIN',
        config: {
          forkStepId: 'fork',
          outputMapping: JSON.parse('{"prototype.value":"branches.a.prototype.value"}'),
        },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      {
        transitionId: 'start-sub',
        fromStepId: 'start',
        toStepId: 'sub',
        trigger: 'auto',
        activities: [
          {
            activityId: 'transition-agent',
            activityName: 'Transition agent',
            activityType: 'INVOKE_AGENT',
            config: {
              agentId: 'reviewer',
              onResult: { alwaysAsk: true },
              outputMapping: JSON.parse('{"result.__proto__.value":"proposalPayload.value"}'),
            },
          },
        ],
      },
      { transitionId: 'sub-join', fromStepId: 'sub', toStepId: 'join', trigger: 'auto' },
      { transitionId: 'join-end', fromStepId: 'join', toStepId: 'end', trigger: 'auto' },
    ],
  }
}

describe('workflow mapping target authoring validation', () => {
  test('finds unsafe targets across step and activity consumers without rejecting sources', () => {
    const issues = collectUnsafeMappingTargetIssues(definitionWithMappings())

    expect(issues).toEqual([
      {
        path: ['steps', 1, 'config', 'inputMapping', '__proto__.polluted'],
        message: UNSAFE_MAPPING_TARGET_MESSAGE,
      },
      {
        path: ['steps', 1, 'activities', 0, 'config', 'outputMapping', 'constructor.value'],
        message: UNSAFE_MAPPING_TARGET_MESSAGE,
      },
      {
        path: ['steps', 2, 'config', 'outputMapping', 'prototype.value'],
        message: UNSAFE_MAPPING_TARGET_MESSAGE,
      },
      {
        path: ['transitions', 0, 'activities', 0, 'config', 'outputMapping', 'result.__proto__.value'],
        message: UNSAFE_MAPPING_TARGET_MESSAGE,
      },
    ])
  })

  test('surfaces unsafe targets through the shared Studio and AI evaluation boundary', () => {
    const evaluation = evaluateWorkflowDefinition(definitionWithMappings())

    expect(evaluation.valid).toBe(false)
    expect(evaluation.issues).toContainEqual({
      path: ['steps', 1, 'config', 'inputMapping', '__proto__.polluted'],
      code: 'custom',
      message: UNSAFE_MAPPING_TARGET_MESSAGE,
    })
    expect(evaluation.problems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          nodeId: 'sub',
          message: expect.stringContaining(UNSAFE_MAPPING_TARGET_MESSAGE),
        }),
      ]),
    )
  })
})
