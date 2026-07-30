import { describe, test, expect } from '@jest/globals'
import {
  workflowStepTypeSchema,
  workflowInstanceStatusSchema,
  stepInstanceStatusSchema,
  userTaskStatusSchema,
  transitionTriggerSchema,
  activityTypeSchema,
  workflowStepSchema,
  workflowTransitionSchema,
  activityRetryPolicySchema,
  activityDefinitionSchema,
  contextSchemaFieldSchema,
  contextSchemaSchema,
  sampleEnvelopeSchema,
  workflowMetadataSchema,
  WORKFLOW_EDITOR_SAMPLES_MAX_CHARS,
  workflowDefinitionDataSchema,
  workflowDefinitionDraftDataSchema,
  createWorkflowDefinitionSchema,
  createWorkflowDefinitionInputSchema,
  updateWorkflowDefinitionSchema,
  updateWorkflowDefinitionInputSchema,
  workflowDefinitionFilterSchema,
  createWorkflowInstanceSchema,
  updateWorkflowInstanceSchema,
  createStepInstanceSchema,
  createUserTaskSchema,
  createWorkflowEventSchema,
  type CreateWorkflowDefinitionInput,
  type CreateWorkflowInstanceInput,
  type CreateStepInstanceInput,
  type CreateUserTaskInput,
} from '../validators'
import {
  collectBranchingRouteWarnings,
  collectDuplicateBranchingCaseWarnings,
} from '../branching-route-warnings'

describe('Workflows Validators', () => {
  describe('workflowStepTypeSchema', () => {
    test('should accept valid step types', () => {
      expect(workflowStepTypeSchema.parse('START')).toBe('START')
      expect(workflowStepTypeSchema.parse('END')).toBe('END')
      expect(workflowStepTypeSchema.parse('USER_TASK')).toBe('USER_TASK')
      expect(workflowStepTypeSchema.parse('AUTOMATED')).toBe('AUTOMATED')
      expect(workflowStepTypeSchema.parse('PARALLEL_FORK')).toBe('PARALLEL_FORK')
      expect(workflowStepTypeSchema.parse('PARALLEL_JOIN')).toBe('PARALLEL_JOIN')
      expect(workflowStepTypeSchema.parse('SUB_WORKFLOW')).toBe('SUB_WORKFLOW')
      expect(workflowStepTypeSchema.parse('WAIT_FOR_SIGNAL')).toBe('WAIT_FOR_SIGNAL')
      expect(workflowStepTypeSchema.parse('WAIT_FOR_TIMER')).toBe('WAIT_FOR_TIMER')
    })

    test('should accept the additive branching step types', () => {
      expect(workflowStepTypeSchema.parse('IF_ELSE')).toBe('IF_ELSE')
      expect(workflowStepTypeSchema.parse('SWITCH')).toBe('SWITCH')
    })

    test('should reject invalid step types', () => {
      expect(() => workflowStepTypeSchema.parse('INVALID')).toThrow()
    })
  })

  describe('branching steps as transition sugar', () => {
    const branchingDefinition = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
        { stepId: 'branch', stepName: 'Branch', stepType: 'IF_ELSE' as const },
        { stepId: 'approve', stepName: 'Approve', stepType: 'AUTOMATED' as const },
        { stepId: 'end', stepName: 'End', stepType: 'END' as const },
      ],
      transitions: [
        {
          transitionId: 'e_start_branch',
          fromStepId: 'start',
          toStepId: 'branch',
          trigger: 'auto' as const,
          priority: 0,
        },
        {
          transitionId: 'e_branch_approve',
          fromStepId: 'branch',
          toStepId: 'approve',
          trigger: 'auto' as const,
          priority: 10,
          condition: { field: 'total', operator: '>', value: 100 },
        },
        {
          transitionId: 'e_approve_end',
          fromStepId: 'approve',
          toStepId: 'end',
          trigger: 'auto' as const,
          priority: 0,
        },
      ],
    }

    test('should accept a definition using IF_ELSE and SWITCH steps', () => {
      const result = workflowDefinitionDataSchema.safeParse(branchingDefinition)
      expect(result.success).toBe(true)

      const switchDefinition = {
        ...branchingDefinition,
        steps: branchingDefinition.steps.map((step) =>
          step.stepId === 'branch' ? { ...step, stepType: 'SWITCH' as const } : step,
        ),
      }
      expect(workflowDefinitionDataSchema.safeParse(switchDefinition).success).toBe(true)
    })

    test('should warn when a branching step has no unconditioned otherwise route', () => {
      const warnings = collectBranchingRouteWarnings(branchingDefinition)
      expect(warnings).toEqual([{ path: ['steps', 1], stepId: 'branch', stepType: 'IF_ELSE' }])
    })

    test('should not warn once an otherwise route exists', () => {
      const withOtherwise = {
        ...branchingDefinition,
        transitions: [
          ...branchingDefinition.transitions,
          {
            transitionId: 'e_branch_end',
            fromStepId: 'branch',
            toStepId: 'end',
            trigger: 'auto' as const,
            priority: 0,
          },
        ],
      }
      expect(collectBranchingRouteWarnings(withOtherwise)).toEqual([])
    })

    test('should not count an error route as the otherwise route (step 2.12)', () => {
      const withErrorRoute = {
        ...branchingDefinition,
        transitions: [
          ...branchingDefinition.transitions,
          {
            transitionId: 'e_branch_handler',
            fromStepId: 'branch',
            toStepId: 'end',
            trigger: 'auto' as const,
            priority: 0,
            kind: 'error' as const,
          },
        ],
      }
      expect(collectBranchingRouteWarnings(withErrorRoute)).toEqual([
        { path: ['steps', 1], stepId: 'branch', stepType: 'IF_ELSE' },
      ])
    })

    test('should treat business-rule pre/post conditions as conditioned routes', () => {
      const ruleRouted = {
        ...branchingDefinition,
        transitions: branchingDefinition.transitions.map((transition) =>
          transition.transitionId === 'e_branch_approve'
            ? {
                transitionId: transition.transitionId,
                fromStepId: transition.fromStepId,
                toStepId: transition.toStepId,
                trigger: transition.trigger,
                priority: transition.priority,
                preConditions: ['11111111-1111-4111-8111-111111111111'],
              }
            : transition,
        ),
      }
      expect(collectBranchingRouteWarnings(ruleRouted)).toHaveLength(1)
    })

    test('should not warn for branching steps without outgoing routes', () => {
      expect(
        collectBranchingRouteWarnings({
          steps: [{ stepId: 'branch', stepName: 'Branch', stepType: 'SWITCH' }],
          transitions: [],
        }),
      ).toEqual([])
    })

    test('should warn when two Switch routes test the same value', () => {
      const duplicated = {
        steps: [
          { stepId: 'switch', stepName: 'Switch', stepType: 'SWITCH' as const },
          { stepId: 'end', stepName: 'End', stepType: 'END' as const },
        ],
        transitions: [
          {
            transitionId: 'e_switch_a',
            fromStepId: 'switch',
            toStepId: 'end',
            condition: { operator: 'AND', rules: [{ field: 'channel', operator: '==', value: 'web' }] },
          },
          {
            transitionId: 'e_switch_b',
            fromStepId: 'switch',
            toStepId: 'end',
            condition: { operator: 'AND', rules: [{ field: 'channel', operator: '==', value: 'web' }] },
          },
          { transitionId: 'e_switch_other', fromStepId: 'switch', toStepId: 'end' },
        ],
      }

      expect(collectDuplicateBranchingCaseWarnings(duplicated)).toEqual([
        { path: ['steps', 0], stepId: 'switch', stepType: 'SWITCH', caseValue: 'channel=web' },
      ])
    })

    test('should not warn when Switch routes test distinct values', () => {
      const distinct = {
        steps: [{ stepId: 'switch', stepName: 'Switch', stepType: 'SWITCH' as const }],
        transitions: [
          {
            transitionId: 'e_switch_a',
            fromStepId: 'switch',
            toStepId: 'end',
            condition: { operator: 'AND', rules: [{ field: 'channel', operator: '==', value: 'web' }] },
          },
          {
            transitionId: 'e_switch_b',
            fromStepId: 'switch',
            toStepId: 'end',
            condition: { operator: 'AND', rules: [{ field: 'channel', operator: '==', value: 'pos' }] },
          },
        ],
      }
      expect(collectDuplicateBranchingCaseWarnings(distinct)).toEqual([])
    })

    test('should not warn for non-branching steps', () => {
      expect(
        collectBranchingRouteWarnings({
          steps: [{ stepId: 'auto', stepName: 'Auto', stepType: 'AUTOMATED' }],
          transitions: [
            {
              transitionId: 'e_auto_end',
              fromStepId: 'auto',
              toStepId: 'end',
              condition: { field: 'x', operator: '==', value: 1 },
            },
          ],
        }),
      ).toEqual([])
    })
  })

  describe('minEngineVersion metadata guard', () => {
    test('should accept an optional positive integer', () => {
      expect(workflowMetadataSchema.parse({ minEngineVersion: 2 }).minEngineVersion).toBe(2)
      expect(workflowMetadataSchema.parse({}).minEngineVersion).toBeUndefined()
    })

    test('should reject non-integer or non-positive versions', () => {
      expect(workflowMetadataSchema.safeParse({ minEngineVersion: 0 }).success).toBe(false)
      expect(workflowMetadataSchema.safeParse({ minEngineVersion: 1.5 }).success).toBe(false)
    })
  })

  describe('workflowInstanceStatusSchema', () => {
    test('should accept valid instance statuses', () => {
      expect(workflowInstanceStatusSchema.parse('RUNNING')).toBe('RUNNING')
      expect(workflowInstanceStatusSchema.parse('PAUSED')).toBe('PAUSED')
      expect(workflowInstanceStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(workflowInstanceStatusSchema.parse('FAILED')).toBe('FAILED')
      expect(workflowInstanceStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
      expect(workflowInstanceStatusSchema.parse('COMPENSATING')).toBe('COMPENSATING')
      expect(workflowInstanceStatusSchema.parse('COMPENSATED')).toBe('COMPENSATED')
    })

    test('should reject invalid instance statuses', () => {
      expect(() => workflowInstanceStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('stepInstanceStatusSchema', () => {
    test('should accept valid step statuses', () => {
      expect(stepInstanceStatusSchema.parse('PENDING')).toBe('PENDING')
      expect(stepInstanceStatusSchema.parse('ACTIVE')).toBe('ACTIVE')
      expect(stepInstanceStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(stepInstanceStatusSchema.parse('FAILED')).toBe('FAILED')
      expect(stepInstanceStatusSchema.parse('SKIPPED')).toBe('SKIPPED')
      expect(stepInstanceStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
    })

    test('should reject invalid step statuses', () => {
      expect(() => stepInstanceStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('userTaskStatusSchema', () => {
    test('should accept valid task statuses', () => {
      expect(userTaskStatusSchema.parse('PENDING')).toBe('PENDING')
      expect(userTaskStatusSchema.parse('IN_PROGRESS')).toBe('IN_PROGRESS')
      expect(userTaskStatusSchema.parse('COMPLETED')).toBe('COMPLETED')
      expect(userTaskStatusSchema.parse('CANCELLED')).toBe('CANCELLED')
      expect(userTaskStatusSchema.parse('ESCALATED')).toBe('ESCALATED')
    })

    test('should reject invalid task statuses', () => {
      expect(() => userTaskStatusSchema.parse('INVALID')).toThrow()
    })
  })

  describe('transitionTriggerSchema', () => {
    test('should accept valid triggers', () => {
      expect(transitionTriggerSchema.parse('auto')).toBe('auto')
      expect(transitionTriggerSchema.parse('manual')).toBe('manual')
      expect(transitionTriggerSchema.parse('signal')).toBe('signal')
      expect(transitionTriggerSchema.parse('timer')).toBe('timer')
    })

    test('should reject invalid triggers', () => {
      expect(() => transitionTriggerSchema.parse('INVALID')).toThrow()
    })
  })

  describe('activityTypeSchema', () => {
    test('should accept valid activity types', () => {
      expect(activityTypeSchema.parse('SEND_EMAIL')).toBe('SEND_EMAIL')
      expect(activityTypeSchema.parse('CALL_API')).toBe('CALL_API')
      expect(activityTypeSchema.parse('UPDATE_ENTITY')).toBe('UPDATE_ENTITY')
      expect(activityTypeSchema.parse('EMIT_EVENT')).toBe('EMIT_EVENT')
      expect(activityTypeSchema.parse('CALL_WEBHOOK')).toBe('CALL_WEBHOOK')
      expect(activityTypeSchema.parse('EXECUTE_FUNCTION')).toBe('EXECUTE_FUNCTION')
      expect(activityTypeSchema.parse('WAIT')).toBe('WAIT')
      expect(activityTypeSchema.parse('SET_VARIABLE')).toBe('SET_VARIABLE')
      expect(activityTypeSchema.parse('INVOKE_AGENT')).toBe('INVOKE_AGENT')
    })

    test('should reject invalid activity types', () => {
      expect(() => activityTypeSchema.parse('INVALID')).toThrow()
    })

    test('should expose exactly the registry-driven builtin ids', () => {
      expect([...activityTypeSchema.options].sort()).toEqual([
        'CALL_API',
        'CALL_WEBHOOK',
        'EMIT_EVENT',
        'EXECUTE_FUNCTION',
        'INVOKE_AGENT',
        'SEND_EMAIL',
        'SET_VARIABLE',
        'UPDATE_ENTITY',
        'WAIT',
      ])
    })
  })

  describe('workflowStepSchema', () => {
    const validStep = {
      stepId: 'start-step',
      stepName: 'Start',
      stepType: 'START' as const,
      description: 'Initial step',
      config: { autoStart: true },
    }

    test('should validate a complete step', () => {
      const result = workflowStepSchema.parse(validStep)
      expect(result.stepId).toBe('start-step')
      expect(result.stepName).toBe('Start')
      expect(result.stepType).toBe('START')
    })

    test('should reject invalid stepId format', () => {
      const invalidId = {
        ...validStep,
        stepId: 'InvalidStep!', // Contains uppercase and special chars
      }

      expect(() => workflowStepSchema.parse(invalidId)).toThrow()
    })

    test('should validate step with user task config', () => {
      const userTaskStep = {
        stepId: 'approve-order',
        stepName: 'Approve Order',
        stepType: 'USER_TASK' as const,
        userTaskConfig: {
          formSchema: {
            fields: [
              { name: 'approved', type: 'boolean', label: 'Approved', required: true },
              { name: 'comments', type: 'text', label: 'Comments' },
            ],
          },
          assignedTo: 'manager@example.com',
          slaDuration: 'P1D', // 1 day
        },
      }

      const result = workflowStepSchema.parse(userTaskStep)
      expect(result.userTaskConfig?.assignedTo).toBe('manager@example.com')
      expect(result.userTaskConfig?.slaDuration).toBe('P1D')
    })

    test('should keep authored role assignment, form key and allowed actions (A1 regression)', () => {
      // The Studio writes these three keys (`lib/graph-utils.ts`) and the engine
      // reads `assignedToRoles` (`lib/step-handler.ts`), but the schema declared
      // none of them: zod stripped the unknown keys and the definition PUT
      // persisted the parsed value, silently discarding the author's work.
      const roleAssignedStep = {
        stepId: 'approve-order',
        stepName: 'Approve Order',
        stepType: 'USER_TASK' as const,
        userTaskConfig: {
          assignedToRoles: ['approver', 'manager'],
          formKey: 'order-approval',
          allowedActions: ['complete', 'reject'],
        },
      }

      const result = workflowStepSchema.parse(roleAssignedStep)

      expect(result.userTaskConfig?.assignedToRoles).toEqual(['approver', 'manager'])
      expect(result.userTaskConfig?.formKey).toBe('order-approval')
      expect(result.userTaskConfig?.allowedActions).toEqual(['complete', 'reject'])
    })

    test('should leave user task config without the new keys untouched', () => {
      const minimalUserTaskStep = {
        stepId: 'approve-order',
        stepName: 'Approve Order',
        stepType: 'USER_TASK' as const,
        userTaskConfig: { assignedTo: 'manager@example.com' },
      }

      const result = workflowStepSchema.parse(minimalUserTaskStep)

      expect(result.userTaskConfig).toEqual({ assignedTo: 'manager@example.com' })
    })

    test('should validate step with retry policy', () => {
      const stepWithRetry = {
        ...validStep,
        retryPolicy: {
          maxAttempts: 3,
          backoffMs: 1000,
        },
      }

      const result = workflowStepSchema.parse(stepWithRetry)
      expect(result.retryPolicy?.maxAttempts).toBe(3)
      expect(result.retryPolicy?.backoffMs).toBe(1000)
    })

    describe('WAIT_FOR_TIMER step config', () => {
      const baseTimerStep = {
        stepId: 'wait-for-timer',
        stepName: 'Pause',
        stepType: 'WAIT_FOR_TIMER' as const,
      }
      const futureUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()

      test('accepts ISO 8601 duration', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { duration: 'PT5M' } })
        ).not.toThrow()
      })

      test('accepts simple-format duration', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { duration: '5m' } })
        ).not.toThrow()
      })

      test('accepts variable-interpolated duration', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { duration: '{{context.delay}}' } })
        ).not.toThrow()
      })

      test('accepts ISO datetime as "until"', () => {
        const futureUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { until: futureUntil } })
        ).not.toThrow()
      })

      test('rejects garbage duration', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { duration: 'not-a-duration' } })
        ).toThrow(/Invalid duration/i)
      })

      test('rejects garbage until', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { until: 'not-a-date' } })
        ).toThrow(/Invalid.*until/i)
      })

      test('rejects past datetime as "until"', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { until: '2020-01-01T00:00:00.000Z' } })
        ).toThrow(/future/i)
      })

      test('accepts templated past-looking until (resolved at runtime)', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: { until: '{{context.deadline}}' } })
        ).not.toThrow()
      })

      test('requires duration or until', () => {
        expect(() =>
          workflowStepSchema.parse({ ...baseTimerStep, config: {} })
        ).toThrow(/requires.*duration.*or.*until/i)
      })

      test('rejects both duration and until', () => {
        expect(() =>
          workflowStepSchema.parse({
            ...baseTimerStep,
            config: { duration: 'PT5M', until: futureUntil },
          })
        ).toThrow(/not both/i)
      })

      test('does not affect non-WAIT_FOR_TIMER steps', () => {
        expect(() =>
          workflowStepSchema.parse({
            stepId: 'do-something',
            stepName: 'Automated',
            stepType: 'AUTOMATED' as const,
            config: { foo: 'not-a-duration' },
          })
        ).not.toThrow()
      })
    })

    describe('WAIT_FOR_CONDITION step config', () => {
      const baseConditionStep = {
        stepId: 'wait-for-payment',
        stepName: 'Wait for payment',
        stepType: 'WAIT_FOR_CONDITION' as const,
      }
      const validCondition = {
        operator: 'AND',
        rules: [{ field: 'payment.status', operator: '==', value: 'captured' }],
      }

      function parseConfig(config: Record<string, unknown>) {
        return workflowStepSchema.safeParse({ ...baseConditionStep, config })
      }

      test('accepts a valid condition with a timeout', () => {
        expect(parseConfig({ condition: validCondition, timeout: 'PT30M' }).success).toBe(true)
      })

      test('accepts the IS_NOT_EMPTY "wait for variable" shorthand', () => {
        const result = parseConfig({
          condition: { field: 'invoiceId', operator: 'IS_NOT_EMPTY', value: null },
          timeout: 'PT30M',
        })
        expect(result.success).toBe(true)
      })

      test('rejects a missing condition', () => {
        const result = parseConfig({ timeout: 'PT30M' })
        expect(result.success).toBe(false)
        expect(JSON.stringify(result)).toContain('condition')
      })

      test('rejects a malformed condition expression through the business-rules validator', () => {
        const result = parseConfig({
          condition: { operator: 'AND', rules: [{ operator: 'NOPE' }] },
          timeout: 'PT30M',
        })
        expect(result.success).toBe(false)
      })

      test('rejects a missing timeout', () => {
        const result = parseConfig({ condition: validCondition })
        expect(result.success).toBe(false)
        expect(JSON.stringify(result)).toContain('timeout')
      })

      test('rejects an invalid timeout duration', () => {
        expect(parseConfig({ condition: validCondition, timeout: '30 minutes' }).success).toBe(false)
      })

      test('rejects an invalid onTimeout value', () => {
        expect(
          parseConfig({ condition: validCondition, timeout: 'PT30M', onTimeout: 'RETRY' }).success
        ).toBe(false)
        expect(
          parseConfig({ condition: validCondition, timeout: 'PT30M', onTimeout: 'CONTINUE' }).success
        ).toBe(true)
      })

      test('rejects a poll interval below the floor or above the ceiling', () => {
        expect(
          parseConfig({ condition: validCondition, timeout: 'PT30M', pollIntervalMs: 4999 }).success
        ).toBe(false)
        expect(
          parseConfig({ condition: validCondition, timeout: 'PT2H', pollIntervalMs: 3600001 }).success
        ).toBe(false)
        expect(
          parseConfig({ condition: validCondition, timeout: 'PT30M', pollIntervalMs: 60000 }).success
        ).toBe(true)
      })

      test('rejects a poll interval longer than the timeout', () => {
        const result = parseConfig({
          condition: validCondition,
          timeout: 'PT10S',
          pollIntervalMs: 60000,
        })
        expect(result.success).toBe(false)
      })

      test('does not affect non-WAIT_FOR_CONDITION steps', () => {
        expect(
          workflowStepSchema.safeParse({
            stepId: 'do-something',
            stepName: 'Automated',
            stepType: 'AUTOMATED' as const,
            config: { condition: 'nonsense' },
          }).success
        ).toBe(true)
      })
    })
  })

  describe('WAIT_FOR_CONDITION outgoing-transition rule', () => {
    const conditionStep = {
      stepId: 'wait_for_payment',
      stepName: 'Wait for payment',
      stepType: 'WAIT_FOR_CONDITION' as const,
      config: {
        condition: { field: 'invoiceId', operator: 'IS_NOT_EMPTY', value: null },
        timeout: 'PT30M',
      },
    }

    function buildDefinition(transitions: Array<Record<string, unknown>>) {
      return {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
          conditionStep,
          { stepId: 'end', stepName: 'End', stepType: 'END' as const },
        ],
        transitions,
      }
    }

    test('rejects a waiting step with no way out', () => {
      const result = workflowDefinitionDataSchema.safeParse(
        buildDefinition([
          {
            transitionId: 'e_start_wait',
            fromStepId: 'start',
            toStepId: 'wait_for_payment',
            trigger: 'auto' as const,
            priority: 0,
          },
        ])
      )
      expect(result.success).toBe(false)
      expect(JSON.stringify(result)).toContain('outgoing transition')
    })

    test('accepts a waiting step with an outgoing transition', () => {
      const result = workflowDefinitionDataSchema.safeParse(
        buildDefinition([
          {
            transitionId: 'e_start_wait',
            fromStepId: 'start',
            toStepId: 'wait_for_payment',
            trigger: 'auto' as const,
            priority: 0,
          },
          {
            transitionId: 'e_wait_end',
            fromStepId: 'wait_for_payment',
            toStepId: 'end',
            trigger: 'auto' as const,
            priority: 0,
          },
        ])
      )
      expect(result.success).toBe(true)
    })
  })

  describe('workflowTransitionSchema', () => {
    const validTransition = {
      transitionId: 'start-to-approve',
      fromStepId: 'start',
      toStepId: 'approve',
      transitionName: 'Begin Approval',
      trigger: 'auto' as const,
      priority: 0,
    }

    test('should validate a complete transition', () => {
      const result = workflowTransitionSchema.parse(validTransition)
      expect(result.transitionId).toBe('start-to-approve')
      expect(result.fromStepId).toBe('start')
      expect(result.toStepId).toBe('approve')
      expect(result.trigger).toBe('auto')
    })

    test('should reject invalid transitionId format', () => {
      const invalidId = {
        ...validTransition,
        transitionId: 'Invalid Transition!',
      }

      expect(() => workflowTransitionSchema.parse(invalidId)).toThrow()
    })

    test('should validate transition with pre-conditions', () => {
      const withConditions = {
        ...validTransition,
        preConditions: [
          { ruleId: 'check-inventory', required: true },
          { ruleId: 'validate-price', required: true },
        ],
      }

      const result = workflowTransitionSchema.parse(withConditions)
      expect(result.preConditions).toHaveLength(2)
      expect(result.preConditions?.[0].ruleId).toBe('check-inventory')
    })

    test('should validate transition with activities', () => {
      const withActivities = {
        ...validTransition,
        activities: [
          {
            activityId: 'send-notification-1',
            activityName: 'Send Notification',
            activityType: 'SEND_EMAIL',
            config: { to: 'user@example.com', subject: 'Test' },
          },
          {
            activityId: 'update-inventory-1',
            activityName: 'Update Inventory',
            activityType: 'UPDATE_ENTITY',
            config: { entityType: 'inventory', updates: { count: 10 } },
          },
        ],
      }

      const result = workflowTransitionSchema.parse(withActivities)
      expect(result.activities).toHaveLength(2)
      expect(result.activities?.[0].activityType).toBe('SEND_EMAIL')
    })
  })

  describe('activityRetryPolicySchema', () => {
    test('should accept the canonical field quadruple', () => {
      const result = activityRetryPolicySchema.parse({
        maxAttempts: 3,
        initialIntervalMs: 1000,
        backoffCoefficient: 2,
        maxIntervalMs: 10000,
      })
      expect(result.maxAttempts).toBe(3)
      expect(result.initialIntervalMs).toBe(1000)
      expect(result.backoffCoefficient).toBe(2)
      expect(result.maxIntervalMs).toBe(10000)
    })

    test('should reject legacy retryDelay/backoffMultiplier field names', () => {
      expect(() =>
        activityRetryPolicySchema.parse({ retryDelay: 1000, backoffMultiplier: 2 })
      ).toThrow()
    })
  })

  describe('activityDefinitionSchema', () => {
    const validActivity = {
      activityId: 'send-email-1',
      activityName: 'Send Email Notification',
      activityType: 'SEND_EMAIL' as const,
      config: {
        to: '{{customer.email}}',
        subject: 'Order Confirmation',
        template: 'order-confirmation',
      },
      async: false,
    }

    test('should validate a complete activity', () => {
      const result = activityDefinitionSchema.parse(validActivity)
      expect(result.activityName).toBe('Send Email Notification')
      expect(result.activityType).toBe('SEND_EMAIL')
      expect(result.async).toBe(false)
    })

    test('should validate activity with retry policy', () => {
      const withRetry = {
        ...validActivity,
        retryPolicy: {
          maxAttempts: 5,
          initialIntervalMs: 1000,
          backoffCoefficient: 2,
          maxIntervalMs: 60000,
        },
      }

      const result = activityDefinitionSchema.parse(withRetry)
      expect(result.retryPolicy?.maxAttempts).toBe(5)
      expect(result.retryPolicy?.backoffCoefficient).toBe(2)
    })

    test('should reject retry policy using legacy field names', () => {
      const withLegacyRetry = {
        ...validActivity,
        retryPolicy: { retryDelay: 1000, backoffMultiplier: 2 },
      }

      expect(() => activityDefinitionSchema.parse(withLegacyRetry)).toThrow()
    })

    test('should validate activity with compensation flag', () => {
      const withCompensation = {
        ...validActivity,
        compensation: { activityId: 'rollback-1', config: {} },
      }

      const result = activityDefinitionSchema.parse(withCompensation)
      expect(result.compensation).toBeDefined()
    })

    describe('WAIT activity config', () => {
      const baseWait = {
        activityId: 'pause-briefly',
        activityName: 'Pause briefly',
        activityType: 'WAIT' as const,
      }
      const futureUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString()

      test('accepts ISO 8601 duration', () => {
        expect(() =>
          activityDefinitionSchema.parse({ ...baseWait, config: { duration: 'PT5M' } })
        ).not.toThrow()
      })

      test('accepts variable-interpolated duration', () => {
        expect(() =>
          activityDefinitionSchema.parse({ ...baseWait, config: { duration: '{{context.delay}}' } })
        ).not.toThrow()
      })

      test('rejects garbage duration', () => {
        expect(() =>
          activityDefinitionSchema.parse({ ...baseWait, config: { duration: 'not-a-duration' } })
        ).toThrow(/Invalid duration/i)
      })

      test('requires duration or until', () => {
        expect(() =>
          activityDefinitionSchema.parse({ ...baseWait, config: {} })
        ).toThrow(/requires.*duration.*or.*until/i)
      })

      test('rejects both duration and until', () => {
        expect(() =>
          activityDefinitionSchema.parse({
            ...baseWait,
            config: { duration: 'PT5M', until: futureUntil },
          })
        ).toThrow(/not both/i)
      })

      test('rejects past datetime as "until"', () => {
        expect(() =>
          activityDefinitionSchema.parse({
            ...baseWait,
            config: { until: '2020-01-01T00:00:00.000Z' },
          })
        ).toThrow(/future/i)
      })

      test('does not affect non-WAIT activities', () => {
        expect(() =>
          activityDefinitionSchema.parse({
            activityId: 'send-email-2',
            activityName: 'Send Email',
            activityType: 'SEND_EMAIL' as const,
            config: { to: 'a@b.c' },
          })
        ).not.toThrow()
      })
    })
  })

  describe('createWorkflowDefinitionSchema', () => {
    const validDefinition: CreateWorkflowDefinitionInput = {
      workflowId: 'simple-approval',
      workflowName: 'Simple Approval Workflow',
      description: 'A basic approval workflow',
      version: 1,
      definition: {
        steps: [
          {
            stepId: 'start',
            stepName: 'Start',
            stepType: 'START',
          },
          {
            stepId: 'end',
            stepName: 'End',
            stepType: 'END',
          },
        ],
        transitions: [
          {
            transitionId: 'start-to-end',
            fromStepId: 'start',
            toStepId: 'end',
            trigger: 'auto',
            priority: 0,
          },
        ],
      },
      metadata: {
        tags: ['approval', 'simple'],
        category: 'workflow',
      },
      enabled: true,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete workflow definition', () => {
      const result = createWorkflowDefinitionSchema.parse(validDefinition)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.workflowName).toBe('Simple Approval Workflow')
      expect(result.version).toBe(1)
      expect(result.enabled).toBe(true)
      expect(result.definition.steps).toHaveLength(2)
      expect(result.definition.transitions).toHaveLength(1)
    })

    test('should apply default values', () => {
      const minimal = {
        workflowId: 'minimal-workflow',
        workflowName: 'Minimal Workflow',
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
            { stepId: 'end', stepName: 'End', stepType: 'END' as const },
          ],
          transitions: [
            {
              transitionId: 'start-to-end',
              fromStepId: 'start',
              toStepId: 'end',
              trigger: 'auto' as const,
              priority: 0,
            },
          ],
        },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowDefinitionSchema.parse(minimal)
      expect(result.version).toBe(1)
      expect(result.enabled).toBe(true)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        workflowName: 'Missing Workflow ID',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalid)).toThrow()
    })

    test('should validate workflowId format', () => {
      const invalidId = {
        ...validDefinition,
        workflowId: 'Invalid Workflow!',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalidId)).toThrow()
    })

    test('should validate workflowId length', () => {
      const tooLong = {
        ...validDefinition,
        workflowId: 'a'.repeat(101),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate workflowName length', () => {
      const tooLong = {
        ...validDefinition,
        workflowName: 'A'.repeat(256),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate description length', () => {
      const tooLong = {
        ...validDefinition,
        description: 'A'.repeat(2001),
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooLong)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validDefinition,
        tenantId: 'not-a-uuid',
      }

      expect(() => createWorkflowDefinitionSchema.parse(invalidUuid)).toThrow()
    })

    test('should require at least 2 steps', () => {
      const tooFewSteps = {
        ...validDefinition,
        definition: {
          steps: [{ stepId: 'start', stepName: 'Start', stepType: 'START' as const }],
          transitions: [],
        },
      }

      expect(() => createWorkflowDefinitionSchema.parse(tooFewSteps)).toThrow()
    })

    test('should require at least 1 transition', () => {
      const noTransitions = {
        ...validDefinition,
        definition: {
          steps: [
            { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
            { stepId: 'end', stepName: 'End', stepType: 'END' as const },
          ],
          transitions: [],
        },
      }

      expect(() => createWorkflowDefinitionSchema.parse(noTransitions)).toThrow()
    })

    test('should accept null/undefined for optional fields', () => {
      const withNulls = {
        ...validDefinition,
        description: null,
        metadata: null,
        effectiveFrom: null,
        effectiveTo: null,
        createdBy: null,
      }

      const result = createWorkflowDefinitionSchema.parse(withNulls)
      expect(result.description).toBeNull()
      expect(result.metadata).toBeNull()
    })
  })

  describe('updateWorkflowDefinitionSchema', () => {
    test('should make all fields optional except id', () => {
      const minimalUpdate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        workflowName: 'Updated Name',
      }

      const result = updateWorkflowDefinitionSchema.parse(minimalUpdate)
      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(result.workflowName).toBe('Updated Name')
    })

    test('should require id field', () => {
      const noId = {
        workflowName: 'Updated Name',
      }

      expect(() => updateWorkflowDefinitionSchema.parse(noId)).toThrow()
    })
  })

  describe('contextSchema on workflow definitions', () => {
    const minimalGraph = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
        { stepId: 'end', stepName: 'End', stepType: 'END' as const },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto' as const,
          priority: 0,
        },
      ],
    }

    const declaredContextSchema = {
      input: {
        fields: [
          { name: 'dealId', type: 'text' as const, label: 'Deal ID', required: true },
          { name: 'amount', type: 'number' as const },
          { name: 'stage', type: 'select' as const, options: ['new', 'won', 'lost'] },
        ],
      },
    }

    test('definition data schema parses and retains a declared contextSchema', () => {
      const result = workflowDefinitionDataSchema.parse({
        ...minimalGraph,
        contextSchema: declaredContextSchema,
      })
      expect(result.contextSchema).toEqual(declaredContextSchema)
    })

    test('definition data without contextSchema stays without it', () => {
      const result = workflowDefinitionDataSchema.parse(minimalGraph)
      expect(result.contextSchema).toBeUndefined()
    })

    test('rejects an invalid field type', () => {
      const invalid = {
        ...minimalGraph,
        contextSchema: {
          input: {
            fields: [{ name: 'dealId', type: 'json' }],
          },
        },
      }
      expect(workflowDefinitionDataSchema.safeParse(invalid).success).toBe(false)
    })

    test('rejects a field with an empty name', () => {
      const invalid = {
        ...minimalGraph,
        contextSchema: {
          input: {
            fields: [{ name: '', type: 'text' }],
          },
        },
      }
      expect(workflowDefinitionDataSchema.safeParse(invalid).success).toBe(false)
    })

    test('contextSchemaSchema accepts an empty object', () => {
      expect(contextSchemaSchema.parse({})).toEqual({})
    })

    test('contextSchemaFieldSchema retains all declared attributes', () => {
      const field = {
        name: 'dueDate',
        type: 'date' as const,
        label: 'Due date',
        required: false,
      }
      expect(contextSchemaFieldSchema.parse(field)).toEqual(field)
    })

    test('create input schema retains contextSchema end-to-end', () => {
      const result = createWorkflowDefinitionInputSchema.parse({
        workflowId: 'ctx-schema-flow',
        workflowName: 'Context Schema Flow',
        definition: {
          ...minimalGraph,
          contextSchema: declaredContextSchema,
        },
      })
      expect(result.definition.contextSchema).toEqual(declaredContextSchema)
    })

    test('create schema retains contextSchema end-to-end', () => {
      const result = createWorkflowDefinitionSchema.parse({
        workflowId: 'ctx-schema-flow',
        workflowName: 'Context Schema Flow',
        definition: {
          ...minimalGraph,
          contextSchema: declaredContextSchema,
        },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      })
      expect(result.definition.contextSchema).toEqual(declaredContextSchema)
    })

    test('update input schema retains contextSchema end-to-end', () => {
      const result = updateWorkflowDefinitionInputSchema.parse({
        definition: {
          ...minimalGraph,
          contextSchema: declaredContextSchema,
        },
      })
      expect(result.definition?.contextSchema).toEqual(declaredContextSchema)
    })

    test('draft schema passes contextSchema through untouched', () => {
      const result = workflowDefinitionDraftDataSchema.parse({
        steps: [{ stepId: 'start' }],
        transitions: [],
        contextSchema: declaredContextSchema,
      })
      expect(result.contextSchema).toEqual(declaredContextSchema)
    })
  })

  describe('editor samples in workflow metadata', () => {
    const minimalGraph = {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' as const },
        { stepId: 'end', stepName: 'End', stepType: 'END' as const },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto' as const,
          priority: 0,
        },
      ],
    }

    const metadataWithSamples = {
      tags: ['approval'],
      category: 'workflow',
      editor: {
        samples: {
          step_1: {
            pinnedAt: '2026-07-27T00:00:00.000Z',
            source: 'manual' as const,
            data: { orderId: 'ord_42', total: 99.5 },
          },
          step_2: {
            pinnedAt: '2026-07-27T12:30:00+02:00',
            source: 'test' as const,
            data: null,
          },
        },
      },
    }

    test('metadata schema retains editor.samples', () => {
      const result = workflowMetadataSchema.parse(metadataWithSamples)
      expect(result.editor).toEqual(metadataWithSamples.editor)
    })

    test('metadata schema keeps unknown editor keys via passthrough', () => {
      const result = workflowMetadataSchema.parse({
        editor: { samples: {}, layout: { zoom: 1.5 } },
      })
      expect(result.editor).toEqual({ samples: {}, layout: { zoom: 1.5 } })
    })

    test('sample envelope rejects a non-ISO pinnedAt', () => {
      const invalid = { pinnedAt: 'yesterday', source: 'manual', data: {} }
      expect(sampleEnvelopeSchema.safeParse(invalid).success).toBe(false)
    })

    test('sample envelope rejects an unknown source', () => {
      const invalid = { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'import', data: {} }
      expect(sampleEnvelopeSchema.safeParse(invalid).success).toBe(false)
    })

    test('create input schema retains editor.samples end-to-end', () => {
      const result = createWorkflowDefinitionInputSchema.parse({
        workflowId: 'samples-flow',
        workflowName: 'Samples Flow',
        definition: minimalGraph,
        metadata: metadataWithSamples,
      })
      expect(result.metadata?.editor).toEqual(metadataWithSamples.editor)
    })

    test('update input schema retains editor.samples end-to-end', () => {
      const result = updateWorkflowDefinitionInputSchema.parse({
        definition: minimalGraph,
        metadata: metadataWithSamples,
      })
      expect(result.metadata?.editor).toEqual(metadataWithSamples.editor)
    })

    test('metadata without editor stays without it', () => {
      const result = workflowMetadataSchema.parse({ tags: ['plain'] })
      expect(result.editor).toBeUndefined()
    })

    test('rejects samples exceeding the total size cap', () => {
      const oversized = {
        editor: {
          samples: {
            step_1: {
              pinnedAt: '2026-07-27T00:00:00.000Z',
              source: 'manual',
              data: { blob: 'x'.repeat(WORKFLOW_EDITOR_SAMPLES_MAX_CHARS) },
            },
          },
        },
      }
      const result = workflowMetadataSchema.safeParse(oversized)
      expect(result.success).toBe(false)
      if (!result.success) {
        const issue = result.error.issues.find((candidate) => candidate.path.join('.') === 'editor.samples')
        expect(issue?.message).toContain(`${WORKFLOW_EDITOR_SAMPLES_MAX_CHARS}`)
      }
    })

    test('rejects oversized samples on the update input schema', () => {
      const oversized = {
        metadata: {
          editor: {
            samples: {
              step_1: {
                pinnedAt: '2026-07-27T00:00:00.000Z',
                source: 'test',
                data: 'x'.repeat(WORKFLOW_EDITOR_SAMPLES_MAX_CHARS + 1),
              },
            },
          },
        },
      }
      expect(updateWorkflowDefinitionInputSchema.safeParse(oversized).success).toBe(false)
    })

    test('accepts samples right at the size boundary', () => {
      const envelopeOverhead = JSON.stringify({
        step_1: { pinnedAt: '2026-07-27T00:00:00.000Z', source: 'manual', data: '' },
      }).length
      const withinCap = {
        editor: {
          samples: {
            step_1: {
              pinnedAt: '2026-07-27T00:00:00.000Z',
              source: 'manual' as const,
              data: 'x'.repeat(WORKFLOW_EDITOR_SAMPLES_MAX_CHARS - envelopeOverhead),
            },
          },
        },
      }
      expect(workflowMetadataSchema.safeParse(withinCap).success).toBe(true)
    })
  })

  describe('workflowDefinitionFilterSchema', () => {
    test('should validate filter with all fields', () => {
      const filter = {
        workflowId: 'simple-approval',
        workflowName: 'Simple Approval',
        enabled: true,
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = workflowDefinitionFilterSchema.parse(filter)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.enabled).toBe(true)
    })

    test('should validate empty filter', () => {
      const result = workflowDefinitionFilterSchema.parse({})
      expect(result).toEqual({})
    })

    test('should validate partial filter', () => {
      const filter = {
        enabled: false,
      }

      const result = workflowDefinitionFilterSchema.parse(filter)
      expect(result.enabled).toBe(false)
    })
  })

  describe('createWorkflowInstanceSchema', () => {
    const validInstance: CreateWorkflowInstanceInput = {
      definitionId: '123e4567-e89b-12d3-a456-426614174002',
      workflowId: 'simple-approval',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: { orderId: '12345', customer: 'John Doe' },
      correlationKey: 'order-12345',
      metadata: {
        entityType: 'Order',
        entityId: '12345',
        initiatedBy: 'system',
      },
      startedAt: new Date('2025-01-01T10:00:00Z'),
      retryCount: 0,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete workflow instance', () => {
      const result = createWorkflowInstanceSchema.parse(validInstance)
      expect(result.workflowId).toBe('simple-approval')
      expect(result.status).toBe('RUNNING')
      expect(result.currentStepId).toBe('start')
      expect(result.context.orderId).toBe('12345')
    })

    test('should apply default values', () => {
      const minimal = {
        definitionId: '123e4567-e89b-12d3-a456-426614174002',
        workflowId: 'simple-approval',
        version: 1,
        status: 'RUNNING' as const,
        currentStepId: 'start',
        context: {},
        startedAt: new Date(),
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowInstanceSchema.parse(minimal)
      expect(result.retryCount).toBe(0)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        workflowId: 'simple-approval',
      }

      expect(() => createWorkflowInstanceSchema.parse(invalid)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validInstance,
        definitionId: 'not-a-uuid',
      }

      expect(() => createWorkflowInstanceSchema.parse(invalidUuid)).toThrow()
    })
  })

  describe('createStepInstanceSchema', () => {
    const validStepInstance: CreateStepInstanceInput = {
      workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
      stepId: 'approve',
      stepName: 'Approve Order',
      stepType: 'USER_TASK',
      status: 'ACTIVE',
      inputData: { orderId: '12345' },
      outputData: null,
      errorData: null,
      enteredAt: new Date('2025-01-01T10:00:00Z'),
      exitedAt: null,
      executionTimeMs: null,
      retryCount: 0,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete step instance', () => {
      const result = createStepInstanceSchema.parse(validStepInstance)
      expect(result.stepId).toBe('approve')
      expect(result.stepName).toBe('Approve Order')
      expect(result.stepType).toBe('USER_TASK')
      expect(result.status).toBe('ACTIVE')
    })

    test('should apply default values', () => {
      const minimal = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepId: 'approve',
        stepName: 'Approve',
        stepType: 'USER_TASK',
        status: 'ACTIVE' as const,
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createStepInstanceSchema.parse(minimal)
      expect(result.retryCount).toBe(0)
    })
  })

  describe('createUserTaskSchema', () => {
    const validUserTask: CreateUserTaskInput = {
      workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
      stepInstanceId: '123e4567-e89b-12d3-a456-426614174004',
      taskName: 'Approve Order',
      description: 'Review and approve order #12345',
      status: 'PENDING',
      formSchema: {
        fields: [
          { name: 'approved', type: 'boolean', label: 'Approved', required: true },
        ],
      },
      formData: null,
      assignedTo: 'manager@example.com',
      assignedToRoles: ['manager', 'admin'],
      claimedBy: null,
      claimedAt: null,
      dueDate: new Date('2025-01-02T10:00:00Z'),
      escalatedAt: null,
      escalatedTo: null,
      completedBy: null,
      completedAt: null,
      comments: null,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete user task', () => {
      const result = createUserTaskSchema.parse(validUserTask)
      expect(result.taskName).toBe('Approve Order')
      expect(result.status).toBe('PENDING')
      expect(result.assignedTo).toBe('manager@example.com')
      expect(result.assignedToRoles).toEqual(['manager', 'admin'])
    })

    test('should reject missing required fields', () => {
      const invalid = {
        taskName: 'Approve Order',
      }

      expect(() => createUserTaskSchema.parse(invalid)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validUserTask,
        workflowInstanceId: 'not-a-uuid',
      }

      expect(() => createUserTaskSchema.parse(invalidUuid)).toThrow()
    })
  })

  describe('createWorkflowEventSchema', () => {
    test('should validate a complete workflow event', () => {
      const validEvent = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepInstanceId: '123e4567-e89b-12d3-a456-426614174004',
        eventType: 'STEP_ENTERED',
        eventData: { stepId: 'approve', timestamp: new Date().toISOString() },
        occurredAt: new Date(),
        userId: 'user-123',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowEventSchema.parse(validEvent)
      expect(result.eventType).toBe('STEP_ENTERED')
      expect(result.eventData.stepId).toBe('approve')
    })

    test('should allow null stepInstanceId', () => {
      const eventWithoutStep = {
        workflowInstanceId: '123e4567-e89b-12d3-a456-426614174003',
        stepInstanceId: null,
        eventType: 'WORKFLOW_STARTED',
        eventData: { initiatedBy: 'system' },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createWorkflowEventSchema.parse(eventWithoutStep)
      expect(result.stepInstanceId).toBeNull()
    })
  })
})

describe('userTaskConfigSchema formSchema — label is optional (widening, 2026-07-30)', () => {
  const stepWithFields = (fields: unknown[]) => ({
    stepId: 'review',
    stepName: 'Review',
    stepType: 'USER_TASK' as const,
    userTaskConfig: { formSchema: { fields } },
  })

  it('accepts a field with no label, because every consumer falls back to the name', () => {
    const parsed = workflowStepSchema.parse(
      stepWithFields([{ name: 'approved', type: 'boolean', required: true }]),
    )
    const [field] = (parsed.userTaskConfig?.formSchema as { fields: { name: string; label?: string }[] }).fields
    expect(field.name).toBe('approved')
    expect(field.label).toBeUndefined()
  })

  it('still keeps a label that is supplied', () => {
    const parsed = workflowStepSchema.parse(
      stepWithFields([{ name: 'approved', type: 'boolean', label: 'Approved' }]),
    )
    const [field] = (parsed.userTaskConfig?.formSchema as { fields: { label?: string }[] }).fields
    expect(field.label).toBe('Approved')
  })

  it('still rejects an EMPTY label rather than silently accepting a blank one', () => {
    expect(() => workflowStepSchema.parse(
      stepWithFields([{ name: 'approved', type: 'boolean', label: '' }]),
    )).toThrow()
  })

  it('still requires the field name, which is what the fallback resolves to', () => {
    expect(() => workflowStepSchema.parse(
      stepWithFields([{ type: 'boolean', label: 'Approved' }]),
    )).toThrow()
  })
})
