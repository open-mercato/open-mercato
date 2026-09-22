/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  buildTriggerPayloadContracts,
  computeContextLedger,
  type LedgerEntry,
  type LedgerStepDefinition,
  type LedgerTransitionDefinition,
  type LedgerWorkflowDefinition,
  type ResolveOutputContract,
} from '../context-ledger'

const step = (
  stepId: string,
  stepType: string,
  extra: Partial<LedgerStepDefinition> = {},
): LedgerStepDefinition => ({ stepId, stepType, ...extra })

const transition = (
  fromStepId: string,
  toStepId: string,
  extra: Partial<LedgerTransitionDefinition> = {},
): LedgerTransitionDefinition => ({
  transitionId: `${fromStepId}-to-${toStepId}`,
  fromStepId,
  toStepId,
  ...extra,
})

const entryAt = (ledger: ReturnType<typeof computeContextLedger>, stepId: string, path: string): LedgerEntry | undefined =>
  ledger.steps[stepId]?.entries.find((entry) => entry.path === path)

const pathsAt = (ledger: ReturnType<typeof computeContextLedger>, stepId: string): string[] =>
  ledger.steps[stepId]?.entries.map((entry) => entry.path) ?? []

describe('computeContextLedger', () => {
  describe('contextSchema at START', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [transition('start', 'end')],
      contextSchema: {
        input: {
          fields: [
            { name: 'dealId', type: 'text', required: true },
            { name: 'amount', type: 'number' },
            { name: 'stage', type: 'select', required: true },
          ],
        },
      },
    }

    test('exposes typed input fields at the START step', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', 'dealId')).toMatchObject({
        type: 'text',
        presence: 'always',
        source: { kind: 'contextSchema', label: 'contextSchema.input' },
      })
      expect(entryAt(ledger, 'start', 'stage')).toMatchObject({ type: 'select', presence: 'always' })
    })

    test('marks non-required input fields as maybe', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', 'amount')).toMatchObject({ type: 'number', presence: 'maybe' })
    })

    test('flows input fields downstream unchanged on a single route', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'dealId')).toMatchObject({ type: 'text', presence: 'always' })
    })
  })

  describe('trigger contributions at START', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [transition('start', 'end')],
      triggers: [
        {
          triggerId: 'on-order-created',
          config: {
            contextMapping: [{ targetKey: 'orderId', sourceExpression: 'id' }],
          },
        },
      ],
    }

    test('adds the whole-payload wildcard as one unknown maybe entry', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', '*')).toMatchObject({
        type: 'unknown',
        presence: 'maybe',
        source: { kind: 'trigger', label: 'trigger:on-order-created:payload' },
      })
    })

    test('adds contextMapping target keys as named untyped maybe entries', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', 'orderId')).toMatchObject({
        type: 'unknown',
        presence: 'maybe',
        source: { kind: 'trigger', label: 'trigger:on-order-created:contextMapping' },
      })
    })

    test('adds the __trigger metadata entries as maybe', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', '__trigger.eventName')).toMatchObject({ type: 'text', presence: 'maybe' })
      expect(entryAt(ledger, 'start', '__trigger.eventPayload')).toMatchObject({ type: 'object', presence: 'maybe' })
      expect(entryAt(ledger, 'start', '__trigger.triggeredAt')).toMatchObject({ type: 'date', presence: 'maybe' })
    })
  })

  describe('typed trigger contextMapping targets', () => {
    const events = [
      {
        id: 'sales.order.created',
        payloadSchema: {
          fields: [
            { path: 'id', type: 'text' },
            { path: 'total', type: 'number' },
            { path: 'placedAt', type: 'date' },
          ],
        },
      },
    ]

    const definitionWith = (eventPattern: string): LedgerWorkflowDefinition => ({
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [transition('start', 'end')],
      triggers: [
        {
          triggerId: 'on-order-created',
          eventPattern,
          config: {
            contextMapping: [
              { targetKey: 'orderId', sourceExpression: 'id' },
              { targetKey: 'orderTotal', sourceExpression: 'total' },
              { targetKey: 'unmapped', sourceExpression: 'missing.path' },
            ],
          },
        },
      ],
    })

    const ledgerFor = (eventPattern: string) => {
      const definition = definitionWith(eventPattern)
      return computeContextLedger(definition, {
        triggerPayloadContracts: buildTriggerPayloadContracts(definition.triggers ?? [], events),
      })
    }

    test('types mapping targets from the declared event payload schema', () => {
      const ledger = ledgerFor('sales.order.created')
      expect(entryAt(ledger, 'start', 'orderId')).toMatchObject({ type: 'text', presence: 'maybe' })
      expect(entryAt(ledger, 'start', 'orderTotal')).toMatchObject({ type: 'number', presence: 'maybe' })
    })

    test('leaves mapping targets whose source path is absent from the schema unknown', () => {
      expect(entryAt(ledgerFor('sales.order.created'), 'start', 'unmapped')).toMatchObject({ type: 'unknown' })
    })

    test('keeps the whole-payload wildcard entry untyped even for schema-backed events', () => {
      expect(entryAt(ledgerFor('sales.order.created'), 'start', '*')).toMatchObject({ type: 'unknown' })
    })

    test('leaves mapping targets unknown for wildcard event patterns', () => {
      const ledger = ledgerFor('sales.order.*')
      expect(entryAt(ledger, 'start', 'orderId')).toMatchObject({ type: 'unknown' })
    })

    test('leaves mapping targets unknown for events without a declared payload schema', () => {
      const ledger = ledgerFor('customers.person.created')
      expect(entryAt(ledger, 'start', 'orderId')).toMatchObject({ type: 'unknown' })
    })

    test('falls back to unknown when no contracts are supplied at all', () => {
      const definition = definitionWith('sales.order.created')
      expect(entryAt(computeContextLedger(definition), 'start', 'orderId')).toMatchObject({ type: 'unknown' })
    })
  })

  describe('buildTriggerPayloadContracts', () => {
    const events = [
      { id: 'sales.order.created', payloadSchema: { fields: [{ path: 'id', type: 'text' }] } },
      { id: 'sales.order.updated', payloadSchema: { fields: [] } },
      { id: 'sales.order.deleted' },
    ]

    test('resolves a contract for an exact event pattern with declared fields', () => {
      const contracts = buildTriggerPayloadContracts(
        [{ triggerId: 'trigger-1', eventPattern: 'sales.order.created' }],
        events,
      )
      expect(contracts['trigger-1']).toEqual({ entries: [{ path: 'id', type: 'text' }] })
    })

    test('skips wildcard patterns, empty schemas, schema-less events, and blank patterns', () => {
      const contracts = buildTriggerPayloadContracts(
        [
          { triggerId: 'wildcard', eventPattern: 'sales.order.*' },
          { triggerId: 'empty-fields', eventPattern: 'sales.order.updated' },
          { triggerId: 'no-schema', eventPattern: 'sales.order.deleted' },
          { triggerId: 'blank', eventPattern: '  ' },
          { triggerId: 'missing', eventPattern: null },
        ],
        events,
      )
      expect(contracts).toEqual({})
    })

    test('maps unrecognized field types to unknown', () => {
      const contracts = buildTriggerPayloadContracts(
        [{ triggerId: 'trigger-1', eventPattern: 'evt' }],
        [{ id: 'evt', payloadSchema: { fields: [{ path: 'weird', type: 'timestamptz' }] } }],
      )
      expect(contracts['trigger-1']).toEqual({ entries: [{ path: 'weird', type: 'unknown' }] })
    })

    test('returns an empty map when there are no triggers or no events', () => {
      expect(buildTriggerPayloadContracts([], events)).toEqual({})
      expect(buildTriggerPayloadContracts([{ triggerId: 't', eventPattern: 'evt' }], [])).toEqual({})
    })
  })

  describe('linear chain accumulation', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('review', 'USER_TASK', {
          userTaskConfig: {
            formSchema: {
              fields: [
                { name: 'approved', type: 'boolean', label: 'Approved', required: true },
                { name: 'note', type: 'text', label: 'Note' },
              ],
            },
          },
        }),
        step('end', 'END'),
      ],
      transitions: [
        transition('start', 'review', {
          activities: [
            {
              activityId: 'notify',
              activityName: 'notifyOwner',
              activityType: 'SEND_EMAIL',
              config: {},
            },
          ],
        }),
        transition('review', 'end'),
      ],
      contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
    }

    test('the USER_TASK step sees upstream context but not its own form output', () => {
      const ledger = computeContextLedger(definition)
      expect(pathsAt(ledger, 'review')).toEqual(['dealId', 'notifyOwner'])
    })

    test('transition activities contribute to the TARGET step incoming ledger', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'review', 'notifyOwner')).toMatchObject({
        type: 'unknown',
        presence: 'always',
        source: { kind: 'activity', activityId: 'notify' },
      })
      expect(entryAt(ledger, 'start', 'notifyOwner')).toBeUndefined()
    })

    test('USER_TASK formSchema fields land flat and typed on downstream steps', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'approved')).toMatchObject({
        type: 'boolean',
        presence: 'always',
        source: { kind: 'userTask', stepId: 'review' },
      })
      expect(entryAt(ledger, 'end', 'note')).toMatchObject({ type: 'text', presence: 'maybe' })
    })
  })

  describe('USER_TASK JSON-Schema formSchema variant', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('task', 'USER_TASK', {
          userTaskConfig: {
            formSchema: {
              type: 'object',
              properties: {
                quantity: { type: 'integer' },
                reason: { type: 'string' },
              },
              required: ['quantity'],
            },
          },
        }),
        step('end', 'END'),
      ],
      transitions: [transition('start', 'task'), transition('task', 'end')],
    }

    test('types properties and honors the required list', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'quantity')).toMatchObject({ type: 'number', presence: 'always' })
      expect(entryAt(ledger, 'end', 'reason')).toMatchObject({ type: 'text', presence: 'maybe' })
    })
  })

  describe('diamond join presence semantics', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('left', 'AUTOMATED'),
        step('right', 'AUTOMATED'),
        step('merge', 'AUTOMATED'),
      ],
      transitions: [
        transition('start', 'left', {
          activities: [
            {
              activityId: 'set-left',
              activityName: 'setLeft',
              activityType: 'SET_VARIABLE',
              config: {
                assignments: [
                  { path: 'branchOnly.left', value: true },
                  { path: 'common', value: 'shared' },
                ],
              },
            },
          ],
        }),
        transition('start', 'right', {
          activities: [
            {
              activityId: 'set-right',
              activityName: 'setRight',
              activityType: 'SET_VARIABLE',
              config: {
                assignments: [
                  { path: 'branchOnly.right', value: true },
                  { path: 'common', value: 'shared' },
                ],
              },
            },
          ],
        }),
        transition('left', 'merge'),
        transition('right', 'merge'),
      ],
      contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
    }

    test('entries present on every route stay always', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'merge', 'dealId')).toMatchObject({ presence: 'always' })
      expect(entryAt(ledger, 'merge', 'common')).toMatchObject({ presence: 'always', type: 'text' })
    })

    test('branch-only entries degrade to maybe at the join point', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'merge', 'branchOnly.left')).toMatchObject({ presence: 'maybe' })
      expect(entryAt(ledger, 'merge', 'branchOnly.right')).toMatchObject({ presence: 'maybe' })
      expect(entryAt(ledger, 'left', 'branchOnly.left')).toMatchObject({ presence: 'always' })
    })

    test('routes disagreeing on type degrade the joined type to unknown', () => {
      const conflicting: LedgerWorkflowDefinition = {
        ...definition,
        transitions: definition.transitions.map((edge) =>
          edge.fromStepId === 'start' && edge.toStepId === 'right'
            ? {
                ...edge,
                activities: [
                  {
                    activityId: 'set-right',
                    activityName: 'setRight',
                    activityType: 'SET_VARIABLE',
                    config: { assignments: [{ path: 'common', value: 42 }] },
                  },
                ],
              }
            : edge,
        ),
      }
      const ledger = computeContextLedger(conflicting)
      expect(entryAt(ledger, 'merge', 'common')).toMatchObject({ type: 'unknown' })
    })
  })

  describe('cycle tolerance', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('draft', 'USER_TASK', {
          userTaskConfig: { formSchema: { fields: [{ name: 'draftBody', type: 'text', label: 'Body', required: true }] } },
        }),
        step('review', 'USER_TASK', {
          userTaskConfig: { formSchema: { fields: [{ name: 'verdict', type: 'select', label: 'Verdict', required: true }] } },
        }),
        step('end', 'END'),
      ],
      transitions: [
        transition('start', 'draft'),
        transition('draft', 'review'),
        transition('review', 'draft'),
        transition('review', 'end'),
      ],
      contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
    }

    test('terminates and produces a stable ledger on a cyclic graph', () => {
      const first = computeContextLedger(definition)
      const second = computeContextLedger(definition)
      expect(first).toEqual(second)
    })

    test('entries produced only inside the loop are maybe at the loop entry, always past a producing step', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'draft', 'dealId')).toMatchObject({ presence: 'always' })
      expect(entryAt(ledger, 'draft', 'verdict')).toMatchObject({ presence: 'maybe' })
      expect(entryAt(ledger, 'review', 'draftBody')).toMatchObject({ presence: 'always' })
      expect(entryAt(ledger, 'end', 'verdict')).toMatchObject({ presence: 'always' })
    })
  })

  describe('SET_VARIABLE assignment typing', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [
        transition('start', 'end', {
          activities: [
            {
              activityId: 'set-vars',
              activityName: 'setVars',
              activityType: 'SET_VARIABLE',
              config: {
                assignments: [
                  { path: 'retries', value: 3 },
                  { path: 'flags.expedite', value: true },
                  { path: 'label', value: 'gold' },
                  { path: 'copied', value: '{{context.dealId}}' },
                  { path: 'meta', value: { nested: true } },
                  { path: '__proto__.polluted', value: 'nope' },
                ],
              },
            },
          ],
        }),
      ],
    }

    test('types literal scalars and objects, leaves templates unknown', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'retries')).toMatchObject({ type: 'number', presence: 'always', source: { kind: 'setVariable' } })
      expect(entryAt(ledger, 'end', 'flags.expedite')).toMatchObject({ type: 'boolean' })
      expect(entryAt(ledger, 'end', 'label')).toMatchObject({ type: 'text' })
      expect(entryAt(ledger, 'end', 'copied')).toMatchObject({ type: 'unknown' })
      expect(entryAt(ledger, 'end', 'meta')).toMatchObject({ type: 'object' })
    })

    test('drops forbidden prototype-pollution assignment paths', () => {
      const ledger = computeContextLedger(definition)
      expect(pathsAt(ledger, 'end').some((path) => path.includes('__proto__'))).toBe(false)
    })
  })

  describe('async activity results', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('work', 'AUTOMATED', {
          activities: [
            { activityId: 'sync-email', activityName: 'sendEmail', activityType: 'SEND_EMAIL', config: {} },
            { activityId: 'slow-call', activityName: 'slowCall', activityType: 'CALL_WEBHOOK', config: {}, async: true },
          ],
        }),
        step('end', 'END'),
      ],
      transitions: [
        transition('start', 'work', {
          activities: [
            { activityId: 'async-edge', activityName: 'edgeWork', activityType: 'SEND_EMAIL', config: {}, async: true },
          ],
        }),
        transition('work', 'end'),
      ],
    }

    test('async transition activities land under activityId_result at the target step', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'work', 'async-edge_result')).toMatchObject({
        type: 'unknown',
        presence: 'always',
        source: { kind: 'asyncResult', activityId: 'async-edge' },
      })
      expect(entryAt(ledger, 'work', 'edgeWork')).toBeUndefined()
    })

    test('async step activities contribute activityId_result to downstream steps only', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'slow-call_result')).toMatchObject({ type: 'unknown', presence: 'always' })
      expect(entryAt(ledger, 'work', 'slow-call_result')).toBeUndefined()
    })

    test('sync step-level activity outputs are not advertised because the engine never persists them', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'sendEmail')).toBeUndefined()
    })
  })

  describe('injected output-contract seam', () => {
    const resolveOutputContract: ResolveOutputContract = (activityType) => {
      if (activityType === 'UPDATE_ENTITY') {
        return {
          entries: [
            { path: 'entityId', type: 'text' },
            { path: 'updatedFields', type: 'object' },
          ],
        }
      }
      return 'unknown'
    }

    const definition: LedgerWorkflowDefinition = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [
        transition('start', 'end', {
          activities: [
            { activityId: 'upd', activityName: 'updateCustomer', activityType: 'UPDATE_ENTITY', config: { commandId: 'customers.update' } },
            { activityId: 'fn', activityName: 'runFunction', activityType: 'EXECUTE_FUNCTION', config: {} },
            { activityId: 'upd-async', activityType: 'UPDATE_ENTITY', config: {}, async: true },
          ],
        }),
      ],
    }

    test('types contract entries under the namespaced activity key', () => {
      const ledger = computeContextLedger(definition, { resolveOutputContract })
      expect(entryAt(ledger, 'end', 'updateCustomer.entityId')).toMatchObject({ type: 'text', presence: 'always' })
      expect(entryAt(ledger, 'end', 'updateCustomer.updatedFields')).toMatchObject({ type: 'object' })
      expect(entryAt(ledger, 'end', 'updateCustomer')).toBeUndefined()
    })

    test('types contract entries under the async result key for async activities', () => {
      const ledger = computeContextLedger(definition, { resolveOutputContract })
      expect(entryAt(ledger, 'end', 'upd-async_result.entityId')).toMatchObject({ type: 'text' })
    })

    test('falls back to a single honest unknown entry when the contract is unknown', () => {
      const ledger = computeContextLedger(definition, { resolveOutputContract })
      expect(entryAt(ledger, 'end', 'runFunction')).toMatchObject({ type: 'unknown', source: { kind: 'activity' } })
    })

    test('defaults every activity output to unknown without an injected resolver', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'updateCustomer')).toMatchObject({ type: 'unknown' })
      expect(entryAt(ledger, 'end', 'updateCustomer.entityId')).toBeUndefined()
    })

    test('falls back to the activityType as namespace key when activityName is absent', () => {
      const anonymous: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END')],
        transitions: [
          transition('start', 'end', {
            activities: [{ activityId: 'em', activityType: 'EMIT_EVENT', config: {} }],
          }),
        ],
      }
      const ledger = computeContextLedger(anonymous)
      expect(entryAt(ledger, 'end', 'EMIT_EVENT')).toMatchObject({ type: 'unknown' })
    })
  })

  describe('continueOnActivityFailure degradation', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [step('start', 'START'), step('end', 'END')],
      transitions: [
        transition('start', 'end', {
          continueOnActivityFailure: true,
          activities: [
            { activityId: 'risky', activityName: 'riskyCall', activityType: 'CALL_WEBHOOK', config: {} },
            {
              activityId: 'set-risky',
              activityName: 'setRisky',
              activityType: 'SET_VARIABLE',
              config: { assignments: [{ path: 'attempted', value: true }] },
            },
          ],
        }),
      ],
    }

    test('marks sync contributions of a continue-on-failure transition as maybe', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'riskyCall')).toMatchObject({ presence: 'maybe' })
      expect(entryAt(ledger, 'end', 'attempted')).toMatchObject({ presence: 'maybe' })
    })
  })

  describe('WAIT_FOR_SIGNAL contributions', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('wait', 'WAIT_FOR_SIGNAL', { signalConfig: { signalName: 'payment_confirmed' } }),
        step('end', 'END'),
      ],
      transitions: [transition('start', 'wait'), transition('wait', 'end')],
    }

    test('adds the untyped payload wildcard and the named signal keys as maybe', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', '*')).toMatchObject({
        type: 'unknown',
        presence: 'maybe',
        source: { kind: 'signal', stepId: 'wait', label: 'signal:payment_confirmed' },
      })
      expect(entryAt(ledger, 'end', 'signal_payment_confirmed_payload')).toMatchObject({ type: 'object', presence: 'maybe' })
      expect(entryAt(ledger, 'end', 'signal_payment_confirmed_receivedAt')).toMatchObject({ type: 'date', presence: 'maybe' })
      expect(entryAt(ledger, 'wait', 'signal_payment_confirmed_payload')).toBeUndefined()
    })

    test('falls back to the stepId as signal name when signalConfig is absent', () => {
      const unnamed: LedgerWorkflowDefinition = {
        ...definition,
        steps: definition.steps.map((definitionStep) =>
          definitionStep.stepId === 'wait' ? step('wait', 'WAIT_FOR_SIGNAL') : definitionStep,
        ),
      }
      const ledger = computeContextLedger(unnamed)
      expect(entryAt(ledger, 'end', 'signal_wait_payload')).toMatchObject({ type: 'object' })
    })
  })

  describe('PARALLEL_JOIN contributions', () => {
    const definition: LedgerWorkflowDefinition = {
      steps: [
        step('start', 'START'),
        step('fork', 'PARALLEL_FORK'),
        step('branch-a', 'AUTOMATED'),
        step('branch-b', 'AUTOMATED'),
        step('joinStep', 'PARALLEL_JOIN', {
          config: {
            outputMapping: { primaryResult: 'branches.branch-a.result', branches: 'branches.branch-b' },
          },
        }),
        step('end', 'END'),
      ],
      transitions: [
        transition('start', 'fork'),
        transition('fork', 'branch-a'),
        transition('fork', 'branch-b'),
        transition('branch-a', 'joinStep'),
        transition('branch-b', 'joinStep'),
        transition('joinStep', 'end'),
      ],
    }

    test('exposes the branches namespace as always and lifted mapping keys as maybe downstream', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'branches')).toMatchObject({
        type: 'object',
        presence: 'always',
        source: { kind: 'join', stepId: 'joinStep' },
      })
      expect(entryAt(ledger, 'end', 'primaryResult')).toMatchObject({ type: 'unknown', presence: 'maybe' })
      expect(entryAt(ledger, 'joinStep', 'branches')).toBeUndefined()
    })

    test('never lets an outputMapping row shadow the reserved branches slot', () => {
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'branches')).toMatchObject({ presence: 'always', type: 'object' })
    })
  })

  describe('SUB_WORKFLOW contributions', () => {
    const subWorkflowDefinition = (config: Record<string, unknown>): LedgerWorkflowDefinition => ({
      steps: [step('start', 'START'), step('child', 'SUB_WORKFLOW', { config }), step('end', 'END')],
      transitions: [transition('start', 'child'), transition('child', 'end')],
    })

    test('advertises outputMapping target keys as maybe — the async resume merges them via sendSignal', () => {
      const ledger = computeContextLedger(
        subWorkflowDefinition({
          subWorkflowId: 'child-flow',
          outputMapping: { approvalStatus: 'result.status', approvedBy: 'reviewer.id' },
        }),
      )
      expect(entryAt(ledger, 'end', 'approvalStatus')).toMatchObject({
        type: 'unknown',
        presence: 'maybe',
        source: { kind: 'subWorkflow', stepId: 'child', label: 'subWorkflow:child' },
      })
      expect(entryAt(ledger, 'end', 'approvedBy')).toMatchObject({ presence: 'maybe' })
    })

    test('keeps a dotted target key as its nested context path (setNestedValue writes it nested)', () => {
      const ledger = computeContextLedger(
        subWorkflowDefinition({ subWorkflowId: 'child-flow', outputMapping: { 'review.status': 'result.status' } }),
      )
      expect(entryAt(ledger, 'end', 'review.status')).toMatchObject({ presence: 'maybe' })
    })

    test('the mapped keys are not yet available to the SUB_WORKFLOW step itself', () => {
      const ledger = computeContextLedger(
        subWorkflowDefinition({ subWorkflowId: 'child-flow', outputMapping: { approvalStatus: 'result.status' } }),
      )
      expect(entryAt(ledger, 'child', 'approvalStatus')).toBeUndefined()
    })

    test('advertises nothing when no outputMapping is declared', () => {
      expect(pathsAt(computeContextLedger(subWorkflowDefinition({ subWorkflowId: 'child-flow' })), 'end')).toEqual([])
      expect(
        pathsAt(computeContextLedger(subWorkflowDefinition({ subWorkflowId: 'child-flow', outputMapping: {} })), 'end'),
      ).toEqual([])
    })

    test('advertises no sendSignal envelope keys — the dotted signal name is unreachable from {{context.*}}', () => {
      const ledger = computeContextLedger(
        subWorkflowDefinition({ subWorkflowId: 'child-flow', outputMapping: { approvalStatus: 'result.status' } }),
      )
      expect(pathsAt(ledger, 'end')).toEqual(['approvalStatus'])
    })
  })

  describe('io.inputs read-through alias', () => {
    test('reads io.inputs as START entries when contextSchema.input is absent', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END')],
        transitions: [transition('start', 'end')],
        io: {
          inputs: [
            { name: 'orderId', type: 'text', required: true },
            { name: 'amount', type: 'number' },
          ],
        },
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', 'orderId')).toMatchObject({
        type: 'text',
        presence: 'always',
        source: { kind: 'contextSchema', label: 'io.inputs (read-through)' },
      })
      expect(entryAt(ledger, 'start', 'amount')).toMatchObject({ type: 'number', presence: 'maybe' })
    })

    test('contextSchema.input stays canonical when both are declared', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END')],
        transitions: [transition('start', 'end')],
        contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
        io: { inputs: [{ name: 'orderId', type: 'text', required: true }] },
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'start', 'dealId')).toMatchObject({
        source: { label: 'contextSchema.input' },
      })
      expect(entryAt(ledger, 'start', 'orderId')).toBeUndefined()
    })
  })

  describe('INVOKE_AGENT contributions', () => {
    const invokeAgentStep = (extra: Record<string, unknown> = {}) =>
      step('agent', 'AUTOMATED', {
        signalConfig: { signalName: 'agent_orchestrator.proposal.ready' },
        activities: [
          {
            activityId: 'invoke-risk-agent',
            activityType: 'INVOKE_AGENT',
            config: { agentId: 'risk-scorer', ...extra },
          },
        ],
      })

    test('advertises outputMapping target keys as maybe when a mapping is declared', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), invokeAgentStep({ outputMapping: { riskScore: 'proposalPayload.score' } }), step('end', 'END')],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'riskScore')).toMatchObject({
        presence: 'maybe',
        source: { kind: 'invokeAgent', stepId: 'agent', activityId: 'invoke-risk-agent' },
      })
      expect(entryAt(ledger, 'end', 'agentProposalId')).toBeUndefined()
    })

    test('advertises the legacy fixed keys as maybe when no mapping is declared', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), invokeAgentStep(), step('end', 'END')],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition)
      for (const path of ['agentId', 'agentProposalId', 'agent_agent', 'disposition', 'proposalId', 'proposalPayload']) {
        expect(entryAt(ledger, 'end', path)).toMatchObject({ presence: 'maybe', source: { kind: 'invokeAgent' } })
      }
    })

    test('always advertises the human-dispose and signal envelope keys, even with a mapping', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), invokeAgentStep({ outputMapping: { riskScore: 'proposalPayload.score' } }), step('end', 'END')],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'disposition')).toMatchObject({ presence: 'maybe', type: 'text' })
      expect(entryAt(ledger, 'end', 'proposalId')).toMatchObject({ presence: 'maybe' })
      expect(entryAt(ledger, 'end', 'signal_agent_orchestrator.proposal.ready_payload')).toMatchObject({
        presence: 'maybe',
        type: 'object',
      })
      expect(entryAt(ledger, 'end', 'signal_agent_orchestrator.proposal.ready_receivedAt')).toMatchObject({
        presence: 'maybe',
        type: 'date',
      })
    })

    test('types mapping targets from the resolved agent envelope contract', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [
          step('start', 'START'),
          invokeAgentStep({
            outputMapping: {
              riskScore: 'proposalPayload.score',
              rationale: 'proposalPayload.rationale',
              dispositionKind: 'kind',
              unmapped: 'proposalPayload.absent',
            },
          }),
          step('end', 'END'),
        ],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition, {
        resolveOutputContract: (activityType, config) => {
          if (activityType !== 'INVOKE_AGENT') return 'unknown'
          if ((config as { agentId?: string })?.agentId !== 'risk-scorer') return 'unknown'
          return {
            entries: [
              { path: 'kind', type: 'text' },
              { path: 'proposalPayload.score', type: 'number' },
              { path: 'proposalPayload.rationale', type: 'text' },
            ],
          }
        },
      })
      expect(entryAt(ledger, 'end', 'riskScore')).toMatchObject({ type: 'number', presence: 'maybe' })
      expect(entryAt(ledger, 'end', 'rationale')).toMatchObject({ type: 'text', presence: 'maybe' })
      expect(entryAt(ledger, 'end', 'dispositionKind')).toMatchObject({ type: 'text' })
      expect(entryAt(ledger, 'end', 'unmapped')).toMatchObject({ type: 'unknown' })
    })

    test('keeps mapping targets unknown when no agent contract resolves', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [
          step('start', 'START'),
          invokeAgentStep({ outputMapping: { riskScore: 'proposalPayload.score' } }),
          step('end', 'END'),
        ],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition, { resolveOutputContract: () => 'unknown' })
      expect(entryAt(ledger, 'end', 'riskScore')).toMatchObject({ type: 'unknown', presence: 'maybe' })
    })

    test('contributes only to steps AFTER the invoke-agent step, not its own incoming view', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), invokeAgentStep(), step('end', 'END')],
        transitions: [transition('start', 'agent'), transition('agent', 'end')],
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'agent', 'disposition')).toBeUndefined()
      expect(entryAt(ledger, 'end', 'disposition')).toBeDefined()
    })
  })

  describe('graph edge cases', () => {
    test('steps unreachable from any START get an empty ledger view', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END'), step('island', 'AUTOMATED')],
        transitions: [transition('start', 'end')],
        contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
      }
      const ledger = computeContextLedger(definition)
      expect(ledger.steps.island).toEqual({ entries: [] })
    })

    test('transitions referencing unknown steps are ignored gracefully', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END')],
        transitions: [transition('start', 'end'), transition('ghost', 'end'), transition('start', 'ghost')],
        contextSchema: { input: { fields: [{ name: 'dealId', type: 'text', required: true }] } },
      }
      const ledger = computeContextLedger(definition)
      expect(entryAt(ledger, 'end', 'dealId')).toMatchObject({ presence: 'always' })
    })

    test('entries are sorted by path for deterministic output', () => {
      const definition: LedgerWorkflowDefinition = {
        steps: [step('start', 'START'), step('end', 'END')],
        transitions: [transition('start', 'end')],
        contextSchema: {
          input: {
            fields: [
              { name: 'zebra', type: 'text', required: true },
              { name: 'alpha', type: 'text', required: true },
            ],
          },
        },
      }
      const ledger = computeContextLedger(definition)
      expect(pathsAt(ledger, 'end')).toEqual(['alpha', 'zebra'])
    })
  })
})
