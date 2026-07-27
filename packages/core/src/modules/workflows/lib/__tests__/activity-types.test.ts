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
]

const requireEntry = (registryModule: ActivityRegistryModule, id: string): ActivityTypeEntry => {
  const entry = registryModule.getActivityType(id)
  if (!entry) throw new Error(`[internal] expected activity type to be registered: ${id}`)
  return entry
}

describe('built-in activity types', () => {
  test('registers all 8 built-in types with i18n keys and icons', () => {
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

  test('async capability: all types are capable except CALL_API and SET_VARIABLE', () => {
    const { registryModule } = loadIsolated()
    const nonCapableIds = ['CALL_API', 'SET_VARIABLE']
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
  })

  test('SET_VARIABLE registers with the Variable icon and a mock returning the would-be assignments', () => {
    const { registryModule } = loadIsolated()
    const entry = requireEntry(registryModule, 'SET_VARIABLE')
    expect(entry.icon).toBe('Variable')
    expect(entry.async).toEqual({ capable: false, reason: 'asyncResumeMergeDoesNotApplyAssignments' })
    if (!entry.mock) throw new Error('[internal] SET_VARIABLE entry must declare a mock')
    const assignments = [{ path: 'customer.priority', value: 'high' }]
    expect(entry.mock({ assignments }, {} as never)).toEqual({ assignments })
  })

  test('WAIT exposes an enqueueDelayMs hint mirroring enqueueActivity semantics', () => {
    const { registryModule } = loadIsolated()
    const waitEntry = requireEntry(registryModule, 'WAIT')
    if (!waitEntry.enqueueDelayMs) throw new Error('[internal] WAIT entry must declare enqueueDelayMs')
    expect(waitEntry.enqueueDelayMs({ duration: '5m' })).toBe(5 * 60 * 1000)
    expect(waitEntry.enqueueDelayMs({})).toBeNull()
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

    test('resolves the registered command outputSchema by commandId', () => {
      const { registryModule, commandRegistryModule } = loadIsolated()
      const dealOutputSchema = z.object({ dealId: z.string().uuid() })
      commandRegistryModule.commandRegistry.register({
        id: 'customers.deals.update',
        execute: async () => ({ dealId: 'noop' }),
        outputSchema: dealOutputSchema,
      })
      try {
        const contract = resolveContract(registryModule)
        expect(contract({ commandId: 'customers.deals.update', input: {} })).toBe(dealOutputSchema)
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
