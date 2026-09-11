/** @jest-environment node */

import { describe, test, expect, jest } from '@jest/globals'
import { z } from 'zod'
import type { ActivityTypeEntry } from '../activity-registry'

type ActivityRegistryModule = typeof import('../activity-registry')
type ActivityTypesModule = typeof import('../activity-types')
type CommandRegistryModule = typeof import('@open-mercato/shared/lib/commands/registry')

type LoadedModules = {
  registryModule: ActivityRegistryModule
  typesModule: ActivityTypesModule
  commandRegistryModule: CommandRegistryModule
}

const loadIsolated = (): LoadedModules => {
  let loaded: LoadedModules | undefined
  jest.isolateModules(() => {
    const typesModule = require('../activity-types') as ActivityTypesModule
    const registryModule = require('../activity-registry') as ActivityRegistryModule
    const commandRegistryModule = require('@open-mercato/shared/lib/commands/registry') as CommandRegistryModule
    loaded = { registryModule, typesModule, commandRegistryModule }
  })
  if (!loaded) throw new Error('[internal] failed to load activity-types in isolation')
  return loaded
}

const EXPECTED_IDS = [
  'SEND_EMAIL',
  'EMIT_EVENT',
  'UPDATE_ENTITY',
  'CALL_WEBHOOK',
  'EXECUTE_FUNCTION',
  'WAIT',
  'CALL_API',
  'SET_VARIABLE',
  'INVOKE_AGENT',
]

const requireEntry = (registryModule: ActivityRegistryModule, id: string): ActivityTypeEntry => {
  const entry = registryModule.getActivityType(id)
  if (!entry) throw new Error(`[internal] expected activity type to be registered: ${id}`)
  return entry
}

const requireMockFn = (
  registryModule: ActivityRegistryModule,
  id: string,
): ((config: unknown, ctx: never) => unknown) => {
  const entryMock = requireEntry(registryModule, id).mock
  if (typeof entryMock !== 'function') {
    throw new Error(`[internal] expected a mock function on activity type: ${id}`)
  }
  return entryMock as (config: unknown, ctx: never) => unknown
}

describe('built-in activity types', () => {
  test('registers all 9 built-in types with i18n keys and icons', () => {
    const { registryModule } = loadIsolated()
    expect(registryModule.activityTypeIds()).toEqual(EXPECTED_IDS)
    for (const id of EXPECTED_IDS) {
      const entry = requireEntry(registryModule, id)
      expect(entry.i18nKey).toBe(`workflows.activities.types.${id}`)
      expect(entry.icon.length).toBeGreaterThan(0)
      expect(entry.form.length).toBeGreaterThan(0)
    }
  })

  test('registerBuiltinActivityTypes is idempotent', () => {
    const { registryModule, typesModule } = loadIsolated()
    expect(() => typesModule.registerBuiltinActivityTypes()).not.toThrow()
    expect(registryModule.activityTypeIds()).toEqual(EXPECTED_IDS)
  })

  test('async capability: all types are capable except CALL_API, SET_VARIABLE, and INVOKE_AGENT', () => {
    const { registryModule } = loadIsolated()
    const nonCapableIds = ['CALL_API', 'SET_VARIABLE', 'INVOKE_AGENT']
    for (const id of EXPECTED_IDS.filter((typeId) => !nonCapableIds.includes(typeId))) {
      expect(requireEntry(registryModule, id).async).toEqual({ capable: true })
    }
    expect(requireEntry(registryModule, 'CALL_API').async).toEqual({
      capable: false,
      reason: 'mintsPerRequestKey',
    })
    expect(requireEntry(registryModule, 'SET_VARIABLE').async).toEqual({
      capable: false,
      reason: 'asyncResumeMergeDoesNotApplyAssignments',
    })
    expect(requireEntry(registryModule, 'INVOKE_AGENT').async).toEqual({
      capable: false,
      reason: 'parksOnDedicatedQueue',
    })
  })

  test('INVOKE_AGENT registers sync-only and delegates through the executor binding seam', () => {
    const { registryModule } = loadIsolated()
    const entry = requireEntry(registryModule, 'INVOKE_AGENT')
    expect(entry.icon).toBe('Bot')
    expect(entry.i18nKey).toBe('workflows.activities.types.INVOKE_AGENT')
    expect(entry.executeAsync).toBeUndefined()
    expect(entry.form.map((field) => field.id)).toEqual(['agentId', 'input', 'onResult', 'outputMapping'])
  })

  describe('INVOKE_AGENT would-do mock', () => {
    test('names the agent and the disposition it would request, never a fabricated outcome', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'INVOKE_AGENT')
      expect(mock(
        { agentId: 'deal_enricher', onResult: { autoApproveThreshold: 0.8 } },
        {} as never,
      )).toEqual({
        simulated: true,
        invoked: false,
        kind: 'would_invoke',
        wouldInvokeAgent: 'deal_enricher',
        wouldRequestDisposition: 'human_review',
        reason: 'noConfidenceInSimulation',
        autoApproveThreshold: 0.8,
      })
    })

    test('reports alwaysAsk as the reason when the step never auto-approves', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'INVOKE_AGENT')
      expect(mock({ agentId: 'triage', onResult: { alwaysAsk: true } }, {} as never)).toEqual({
        simulated: true,
        invoked: false,
        kind: 'would_invoke',
        wouldInvokeAgent: 'triage',
        wouldRequestDisposition: 'human_review',
        reason: 'alwaysAsk',
        autoApproveThreshold: null,
      })
    })

    test('never returns a runtime disposition kind, so no consumer can mistake it for a real outcome', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'INVOKE_AGENT')
      const output = mock({ agentId: 'a', onResult: { autoApproveThreshold: 0.9 } }, {} as never) as {
        kind: string
      }
      expect(['auto_approved', 'researcher', 'user_task']).not.toContain(output.kind)
    })

    test('tolerates an unconfigured or still-templated step', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'INVOKE_AGENT')
      expect(mock(null, {} as never)).toEqual({
        simulated: true,
        invoked: false,
        kind: 'would_invoke',
        wouldInvokeAgent: null,
        wouldRequestDisposition: 'human_review',
        reason: 'noConfidenceInSimulation',
        autoApproveThreshold: null,
      })
    })
  })

  test('SET_VARIABLE registers with the Variable icon and a mock returning the would-be assignments', () => {
    const { registryModule } = loadIsolated()
    const entry = requireEntry(registryModule, 'SET_VARIABLE')
    expect(entry.icon).toBe('Variable')
    expect(entry.async).toEqual({ capable: false, reason: 'asyncResumeMergeDoesNotApplyAssignments' })
    const mock = requireMockFn(registryModule, 'SET_VARIABLE')
    const assignments = [{ path: 'customer.priority', value: 'high' }]
    expect(mock({ assignments }, {} as never)).toEqual({ simulated: true, assignments })
  })

  test('WAIT exposes an enqueueDelayMs hint mirroring enqueueActivity semantics', () => {
    const { registryModule } = loadIsolated()
    const waitEntry = requireEntry(registryModule, 'WAIT')
    if (!waitEntry.enqueueDelayMs) throw new Error('[internal] WAIT entry must declare enqueueDelayMs')
    expect(waitEntry.enqueueDelayMs({ duration: '5m' })).toBe(5 * 60 * 1000)
    expect(waitEntry.enqueueDelayMs({})).toBeNull()
  })

  describe('would-do mocks', () => {
    test('SEND_EMAIL mock reports what it would send without sending', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'SEND_EMAIL')
      expect(mock({ to: 'ops@example.com', subject: 'Order approved' }, {} as never)).toEqual({
        sent: false,
        simulated: true,
        wouldSendTo: 'ops@example.com',
        subject: 'Order approved',
      })
    })

    test('EMIT_EVENT mock reports the event it would emit without emitting', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'EMIT_EVENT')
      expect(mock({ eventName: 'sales.order.completed', payload: { orderId: 'o-1' } }, {} as never)).toEqual({
        emitted: false,
        simulated: true,
        eventName: 'sales.order.completed',
      })
    })

    test('CALL_WEBHOOK mock reports the call it would make, defaulting method to POST', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'CALL_WEBHOOK')
      expect(mock({ url: 'https://example.com/hook' }, {} as never)).toEqual({
        simulated: true,
        wouldCall: { url: 'https://example.com/hook', method: 'POST' },
      })
      expect(mock({ url: 'https://example.com/hook', method: 'PUT' }, {} as never)).toEqual({
        simulated: true,
        wouldCall: { url: 'https://example.com/hook', method: 'PUT' },
      })
    })

    test('UPDATE_ENTITY mock reports the command it would run without executing', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'UPDATE_ENTITY')
      expect(mock({ commandId: 'sales.orders.update', input: { id: 'o-1' } }, {} as never)).toEqual({
        executed: false,
        simulated: true,
        commandId: 'sales.orders.update',
      })
    })

    test('WAIT mock returns a synthetic completed wait', () => {
      const { registryModule } = loadIsolated()
      const mock = requireMockFn(registryModule, 'WAIT')
      expect(mock({ duration: 'PT5M' }, {} as never)).toEqual({ waited: true, simulated: true })
    })

    test("EXECUTE_FUNCTION and CALL_API refuse simulation with the 'refuse' marker", () => {
      const { registryModule } = loadIsolated()
      expect(requireEntry(registryModule, 'EXECUTE_FUNCTION').mock).toBe('refuse')
      expect(requireEntry(registryModule, 'CALL_API').mock).toBe('refuse')
    })

    test('mocks echo uninterpolated template strings from raw config', () => {
      const { registryModule } = loadIsolated()
      const sendEmailMock = requireMockFn(registryModule, 'SEND_EMAIL')
      expect(sendEmailMock({ to: '{{context.customerEmail}}', subject: '{{context.subject}}' }, {} as never)).toEqual({
        sent: false,
        simulated: true,
        wouldSendTo: '{{context.customerEmail}}',
        subject: '{{context.subject}}',
      })
      const webhookMock = requireMockFn(registryModule, 'CALL_WEBHOOK')
      expect(webhookMock({ url: '{{context.webhookUrl}}', method: '{{context.method}}' }, {} as never)).toEqual({
        simulated: true,
        wouldCall: { url: '{{context.webhookUrl}}', method: '{{context.method}}' },
      })
    })

    test('mocks tolerate non-object config without throwing', () => {
      const { registryModule } = loadIsolated()
      expect(requireMockFn(registryModule, 'SEND_EMAIL')(null, {} as never)).toEqual({
        sent: false,
        simulated: true,
        wouldSendTo: undefined,
        subject: undefined,
      })
      expect(requireMockFn(registryModule, 'EMIT_EVENT')('not-a-config', {} as never)).toEqual({
        emitted: false,
        simulated: true,
        eventName: undefined,
      })
      expect(requireMockFn(registryModule, 'CALL_WEBHOOK')(undefined, {} as never)).toEqual({
        simulated: true,
        wouldCall: { url: undefined, method: 'POST' },
      })
      expect(requireMockFn(registryModule, 'UPDATE_ENTITY')(42, {} as never)).toEqual({
        executed: false,
        simulated: true,
        commandId: undefined,
      })
    })
  })

  describe('config schemas', () => {
    type SchemaFixture = {
      id: string
      valid: Record<string, unknown>
      templated: Record<string, unknown>
      invalid: Record<string, unknown>
    }

    const fixtures: SchemaFixture[] = [
      {
        id: 'SEND_EMAIL',
        valid: { to: 'ops@example.com', subject: 'Order approved', body: 'Done' },
        templated: { to: '{{context.customerEmail}}', subject: '{{context.subject}}' },
        invalid: { subject: 'Missing recipient' },
      },
      {
        id: 'EMIT_EVENT',
        valid: { eventName: 'sales.order.completed', payload: { orderId: 'o-1' } },
        templated: { eventName: '{{context.eventName}}', payload: { id: '{{context.id}}' } },
        invalid: { payload: { orderId: 'o-1' } },
      },
      {
        id: 'UPDATE_ENTITY',
        valid: {
          commandId: 'sales.orders.update',
          input: { id: 'abc', statusValue: 'approved' },
          statusDictionary: 'sales.order_status',
        },
        templated: { commandId: 'sales.orders.update', input: { id: '{{context.orderId}}' } },
        invalid: { input: { id: 'abc' } },
      },
      {
        id: 'CALL_WEBHOOK',
        valid: { url: 'https://example.com/hook', method: 'POST', headers: { 'X-Key': 'v' } },
        templated: { url: '{{context.webhookUrl}}', method: '{{context.method}}' },
        invalid: { method: 'POST' },
      },
      {
        id: 'EXECUTE_FUNCTION',
        valid: { functionName: 'recalculateTotals', args: { orderId: 'o-1' } },
        templated: { functionName: '{{context.functionName}}' },
        invalid: { args: {} },
      },
      {
        id: 'WAIT',
        valid: { duration: 'PT5M' },
        templated: { duration: '{{context.delay}}' },
        invalid: {},
      },
      {
        id: 'SET_VARIABLE',
        valid: { assignments: [{ path: 'customer.priority', value: 'high' }] },
        templated: { assignments: [{ path: 'customer.priority', value: '{{context.priority}}' }] },
        invalid: { assignments: [] },
      },
      {
        id: 'INVOKE_AGENT',
        valid: { agentId: 'company_researcher', input: { dealId: 'd-1' }, onResult: { alwaysAsk: true } },
        templated: { agentId: '{{context.agentId}}', input: { dealId: '{{context.dealId}}' }, onResult: { autoApproveThreshold: 0.8 } },
        invalid: { input: { dealId: 'd-1' } },
      },
      {
        id: 'CALL_API',
        valid: { endpoint: '/api/sales/orders', method: 'PUT', validateTenantMatch: true, timeout: 5000 },
        templated: {
          endpoint: '{{context.endpoint}}',
          method: '{{context.method}}',
          validateTenantMatch: '{{context.strict}}',
          timeout: '{{context.timeout}}',
        },
        invalid: { method: 'GET' },
      },
    ]

    test.each(fixtures)('$id accepts valid + templated fixtures and rejects invalid', ({ id, valid, templated, invalid }) => {
      const { registryModule } = loadIsolated()
      const schema = requireEntry(registryModule, id).configSchema
      expect(schema.safeParse(valid).success).toBe(true)
      expect(schema.safeParse(templated).success).toBe(true)
      expect(schema.safeParse(invalid).success).toBe(false)
    })

    test.each(fixtures)('$id tolerates extra config keys', ({ id, valid }) => {
      const { registryModule } = loadIsolated()
      const schema = requireEntry(registryModule, id).configSchema
      expect(schema.safeParse({ ...valid, legacyExtraKey: 'kept' }).success).toBe(true)
    })

    test('WAIT enforces duration XOR until', () => {
      const { registryModule } = loadIsolated()
      const schema = requireEntry(registryModule, 'WAIT').configSchema
      expect(schema.safeParse({ duration: '5m' }).success).toBe(true)
      expect(schema.safeParse({ until: '2099-01-01T00:00:00Z' }).success).toBe(true)
      expect(schema.safeParse({ until: '{{context.deadline}}' }).success).toBe(true)
      expect(schema.safeParse({}).success).toBe(false)
      expect(schema.safeParse({ duration: '5m', until: '2099-01-01T00:00:00Z' }).success).toBe(false)
      expect(schema.safeParse({ duration: 'not-a-duration' }).success).toBe(false)
      expect(schema.safeParse({ until: '2001-01-01T00:00:00Z' }).success).toBe(false)
    })
  })

  describe('UPDATE_ENTITY outputContract', () => {
    const resolveContract = (registryModule: ActivityRegistryModule): ((config: unknown) => unknown) => {
      const contract = requireEntry(registryModule, 'UPDATE_ENTITY').outputContract
      if (typeof contract !== 'function') {
        throw new Error('[internal] UPDATE_ENTITY must declare a function outputContract')
      }
      return contract
    }

    test('nests the registered command outputSchema under the executor envelope', () => {
      const { registryModule, commandRegistryModule } = loadIsolated()
      const dealOutputSchema = z.object({ dealId: z.string().uuid() })
      commandRegistryModule.commandRegistry.register({
        id: 'customers.deals.update',
        execute: async () => ({ dealId: 'noop' }),
        outputSchema: dealOutputSchema,
      })
      try {
        const contract = resolveContract(registryModule)
        const resolved = contract({ commandId: 'customers.deals.update', input: {} })
        if (resolved === 'unknown') throw new Error('[internal] expected a resolved contract')
        expect(
          resolved.safeParse({
            executed: true,
            commandId: 'customers.deals.update',
            logEntryId: 'log-1',
            result: { dealId: '5f0b2f2a-8f6f-4a2f-9a1e-3c1d2e4f5a6b' },
          }).success,
        ).toBe(true)
      } finally {
        commandRegistryModule.commandRegistry.clear()
      }
    })

    test("degrades to 'unknown' for unregistered commands and malformed config", () => {
      const { registryModule } = loadIsolated()
      const contract = resolveContract(registryModule)
      expect(contract({ commandId: 'not.registered.command', input: {} })).toBe('unknown')
      expect(contract({ commandId: '', input: {} })).toBe('unknown')
      expect(contract({ input: {} })).toBe('unknown')
      expect(contract(null)).toBe('unknown')
    })
  })
})
