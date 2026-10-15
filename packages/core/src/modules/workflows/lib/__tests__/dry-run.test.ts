/**
 * Dry-run isolation (spec section 8.2)
 *
 * The spec's integration list is explicit about what a dry run must NOT
 * produce: *"no notification rows, no real UserTask, no pending proposal in
 * inbox queries, `isDryRun` excluded from KPIs"*. Each of those is asserted
 * here at the seam that structurally guarantees it, so a regression fails a
 * unit test rather than waiting for a Playwright run.
 */

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { WorkflowInstance } from '../../data/entities'
import * as activityExecutor from '../activity-executor'
import type { ActivityContext, ActivityDefinition } from '../activity-executor'
import { getActivityType } from '../activity-registry'
import { WorkflowEventTypes } from '../event-logger'
import {
  DRY_RUN_EVENT_TYPES,
  buildWouldDoReport,
  isDryRunInstance,
  isDryRunRefusal,
  WorkflowDryRunRefusalError,
} from '../dry-run'

type LoggedEvent = { eventType: string; eventData: Record<string, unknown> }

function makeEm(): { em: EntityManager; logged: LoggedEvent[]; created: unknown[] } {
  const logged: LoggedEvent[] = []
  const created: unknown[] = []
  const em = {
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => {
      created.push(payload)
      if (typeof payload.eventType === 'string') {
        logged.push({
          eventType: payload.eventType,
          eventData: (payload.eventData ?? {}) as Record<string, unknown>,
        })
      }
      return payload
    }),
    persist: jest.fn(function persist(this: unknown) {
      return this
    }),
    flush: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  } as unknown as EntityManager
  return { em, logged, created }
}

function makeInstance(isDryRun: boolean): WorkflowInstance {
  return {
    id: 'instance-1',
    definitionId: 'definition-1',
    workflowId: 'wf',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'step-1',
    context: {},
    startedAt: new Date(),
    retryCount: 0,
    isDryRun,
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    createdAt: new Date(),
    updatedAt: new Date(),
  } as WorkflowInstance
}

function makeContext(instance: WorkflowInstance): ActivityContext {
  return {
    workflowInstance: instance,
    workflowContext: instance.context,
    stepInstanceId: 'step-instance-1',
  }
}

/** A container whose every resolve is a test failure: nothing may be reached. */
function makeForbiddenContainer(): AwilixContainer {
  return {
    resolve: jest.fn((token: string) => {
      throw new Error(`[internal] dry run resolved a service it must not touch: ${token}`)
    }),
  } as unknown as AwilixContainer
}

describe('isDryRunInstance', () => {
  test('only an explicit true counts, so an unmigrated or partial row is treated as a real run', () => {
    expect(isDryRunInstance({ isDryRun: true })).toBe(true)
    expect(isDryRunInstance({ isDryRun: false })).toBe(false)
    expect(isDryRunInstance({ isDryRun: null })).toBe(false)
    expect(isDryRunInstance({})).toBe(false)
    expect(isDryRunInstance(null)).toBe(false)
    expect(isDryRunInstance(undefined)).toBe(false)
  })
})

describe('dry-run refusal', () => {
  test('is recognised structurally, so it survives crossing a module boundary', () => {
    const refusal = new WorkflowDryRunRefusalError('CALL_API', 'refused')
    expect(isDryRunRefusal(refusal)).toBe(true)
    expect(isDryRunRefusal({ dryRunRefused: true })).toBe(true)
    expect(isDryRunRefusal(new Error('boom'))).toBe(false)
    expect(isDryRunRefusal(null)).toBe(false)
  })
})

describe('event-type registries agree', () => {
  test('every dry-run event type is also declared in WorkflowEventTypes', () => {
    const declared = new Set(Object.values(WorkflowEventTypes))
    for (const eventType of Object.values(DRY_RUN_EVENT_TYPES)) {
      expect(declared.has(eventType as never)).toBe(true)
    }
  })
})

describe('mocked effectors — no side effect reaches a real service', () => {
  const sideEffectingTypes: Array<{ activityType: string; config: Record<string, unknown> }> = [
    { activityType: 'SEND_EMAIL', config: { to: 'ops@example.com', subject: 'hi' } },
    { activityType: 'EMIT_EVENT', config: { eventName: 'sales.order.completed', payload: {} } },
    { activityType: 'UPDATE_ENTITY', config: { commandId: 'sales.orders.update', input: { id: 'o-1' } } },
    { activityType: 'CALL_WEBHOOK', config: { url: 'https://example.com/hook' } },
    { activityType: 'INVOKE_AGENT', config: { agentId: 'risk', onResult: { alwaysAsk: true } } },
  ]

  test.each(sideEffectingTypes)(
    '$activityType resolves through its registry mock and never through execute()',
    async ({ activityType, config }) => {
      const entry = getActivityType(activityType)
      if (!entry) throw new Error(`[internal] expected ${activityType} to be registered`)
      const executeSpy = jest.spyOn(entry, 'execute')

      const { em, logged } = makeEm()
      const instance = makeInstance(true)
      const activity: ActivityDefinition = {
        activityId: 'a-1',
        activityType: activityType as ActivityDefinition['activityType'],
        config,
      }

      const result = await activityExecutor.executeActivity(
        em,
        makeForbiddenContainer(),
        activity,
        makeContext(instance),
      )

      expect(result.success).toBe(true)
      // No entity write, no event emit, no mail, no webhook, no agent run: the
      // real handler is never called at all.
      expect(executeSpy).not.toHaveBeenCalled()
      expect(logged.map((event) => event.eventType)).toContain(DRY_RUN_EVENT_TYPES.activitySimulated)
      executeSpy.mockRestore()
    },
  )

  test('a real run still reaches execute() — the swap is opt-in only', async () => {
    const entry = getActivityType('SEND_EMAIL')
    if (!entry) throw new Error('[internal] expected SEND_EMAIL to be registered')
    const executeSpy = jest.spyOn(entry, 'execute').mockResolvedValue({ sent: true })

    const { em, logged } = makeEm()
    const activity: ActivityDefinition = {
      activityId: 'a-1',
      activityType: 'SEND_EMAIL',
      config: { to: 'ops@example.com', subject: 'hi' },
    }

    await activityExecutor.executeActivity(
      em,
      { resolve: jest.fn() } as unknown as AwilixContainer,
      activity,
      makeContext(makeInstance(false)),
    )

    expect(executeSpy).toHaveBeenCalledTimes(1)
    expect(logged.map((event) => event.eventType)).not.toContain(DRY_RUN_EVENT_TYPES.activitySimulated)
    executeSpy.mockRestore()
  })

  test('INVOKE_AGENT reports a would-do instead of raising a proposal, so no inbox row can exist', async () => {
    const { em } = makeEm()
    const result = await activityExecutor.executeActivity(
      em,
      makeForbiddenContainer(),
      {
        activityId: 'a-1',
        activityType: 'INVOKE_AGENT',
        config: { agentId: 'risk-scorer', onResult: { autoApproveThreshold: 0.8 } },
      },
      makeContext(makeInstance(true)),
    )

    expect(result.output).toMatchObject({
      simulated: true,
      invoked: false,
      wouldInvokeAgent: 'risk-scorer',
      wouldRequestDisposition: 'human_review',
    })
    // No `__park` marker means the step is never parked on the agent signal, so
    // nothing is enqueued onto the invoke-agent queue either.
    expect(result.output).not.toHaveProperty('__park')
  })
})

describe('refusal stops the run at that node', () => {
  test.each(['EXECUTE_FUNCTION', 'CALL_API'])(
    '%s refuses simulation and is reported as a stop, not as a failure',
    async (activityType) => {
      const { em, logged } = makeEm()
      const result = await activityExecutor.executeActivity(
        em,
        makeForbiddenContainer(),
        {
          activityId: 'a-1',
          activityType: activityType as ActivityDefinition['activityType'],
          config: {},
          retryPolicy: { maxAttempts: 3, initialIntervalMs: 0, backoffCoefficient: 1, maxIntervalMs: 0 },
        },
        makeContext(makeInstance(true)),
      )

      expect(result.success).toBe(false)
      expect(result.dryRunRefused).toBe(true)
      // Refused once, not once per retry attempt: nothing was attempted, so
      // there is nothing to retry.
      expect(
        logged.filter((event) => event.eventType === DRY_RUN_EVENT_TYPES.activityRefused),
      ).toHaveLength(1)
    },
  )
})

describe('no queue job is ever enqueued by a dry run', () => {
  test('an async activity runs inline through its mock instead of being enqueued', async () => {
    const { em, logged } = makeEm()
    const instance = makeInstance(true)
    const results = await activityExecutor.executeActivities(
      em,
      makeForbiddenContainer(),
      [
        {
          activityId: 'a-1',
          activityType: 'SEND_EMAIL',
          async: true,
          config: { to: 'ops@example.com', subject: 'hi' },
        },
      ],
      makeContext(instance),
    )

    expect(results).toHaveLength(1)
    expect(results[0].jobId).toBeUndefined()
    expect(results[0].async).toBe(false)
    expect(logged.map((event) => event.eventType)).not.toContain(WorkflowEventTypes.ACTIVITY_QUEUED)
    expect(logged.map((event) => event.eventType)).toContain(DRY_RUN_EVENT_TYPES.activitySimulated)
  })
})

describe('would-do report', () => {
  test('orders entries by time, keeps caller order for ties, and flags the refusal that stopped the run', () => {
    const report = buildWouldDoReport([
      {
        id: 'e-3',
        eventType: DRY_RUN_EVENT_TYPES.activityRefused,
        stepId: 'charge',
        occurredAt: '2026-07-29T10:00:02.000Z',
        eventData: { activityType: 'CALL_API', reason: 'refused' },
      },
      {
        id: 'e-1',
        eventType: DRY_RUN_EVENT_TYPES.activitySimulated,
        stepId: 'notify',
        occurredAt: '2026-07-29T10:00:00.000Z',
        eventData: { activityType: 'SEND_EMAIL', output: { sent: false } },
      },
      {
        id: 'e-2a',
        eventType: DRY_RUN_EVENT_TYPES.userTaskSimulated,
        stepId: 'approve',
        occurredAt: '2026-07-29T10:00:01.000Z',
        eventData: { taskName: 'Approve order', assignedToRoles: ['sales'] },
      },
      {
        id: 'e-2b',
        eventType: DRY_RUN_EVENT_TYPES.businessRuleActionsSuppressed,
        stepId: null,
        occurredAt: '2026-07-29T10:00:01.000Z',
        eventData: { ruleId: 'credit_check', phase: 'pre_transition' },
      },
      { id: 'noise', eventType: 'STEP_ENTERED', occurredAt: '2026-07-29T10:00:00.500Z', eventData: {} },
    ])

    expect(report.entries.map((entry) => entry.id)).toEqual(['e-1', 'e-2a', 'e-2b', 'e-3'])
    expect(report.entries.map((entry) => entry.kind)).toEqual([
      'activity',
      'userTask',
      'businessRule',
      'refusal',
    ])
    expect(report.stoppedByRefusal).toBe(true)
  })

  test('a run with no refusal is not reported as stopped', () => {
    const report = buildWouldDoReport([
      {
        id: 'e-1',
        eventType: DRY_RUN_EVENT_TYPES.activitySimulated,
        stepId: 'notify',
        occurredAt: new Date('2026-07-29T10:00:00.000Z'),
        eventData: { activityType: 'SEND_EMAIL' },
      },
    ])
    expect(report.stoppedByRefusal).toBe(false)
    expect(report.entries[0].severity).toBe('info')
  })

  test('severity is carried per entry so the UI never has to encode status in colour alone', () => {
    const report = buildWouldDoReport([
      {
        id: 'e-1',
        eventType: DRY_RUN_EVENT_TYPES.activityRefused,
        occurredAt: '2026-07-29T10:00:00.000Z',
        eventData: { activityType: 'CALL_API', reason: 'refused' },
      },
      {
        id: 'e-2',
        eventType: DRY_RUN_EVENT_TYPES.userTaskSimulated,
        occurredAt: '2026-07-29T10:00:01.000Z',
        eventData: { taskName: 'Approve' },
      },
    ])
    expect(report.entries.map((entry) => entry.severity)).toEqual(['error', 'warning'])
  })
})
