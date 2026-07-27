/** @jest-environment node */

import { describe, test, expect, jest } from '@jest/globals'
import { z } from 'zod'
import type { Module } from '@open-mercato/shared/modules/registry'
import { registerModules } from '@open-mercato/shared/lib/modules/registry'
import { computeContextLedger, type LedgerWorkflowDefinition } from '../context-ledger'

type ServerContractModule = typeof import('../server-output-contract')
type CommandRegistryModule = typeof import('@open-mercato/shared/lib/commands/registry')
type EndpointCatalogModule = typeof import('../endpoint-catalog')

type LoadedModules = {
  serverContractModule: ServerContractModule
  commandRegistryModule: CommandRegistryModule
  endpointCatalogModule: EndpointCatalogModule
}

const loadIsolated = (): LoadedModules => {
  let loaded: LoadedModules | undefined
  jest.isolateModules(() => {
    const serverContractModule = require('../server-output-contract') as ServerContractModule
    const commandRegistryModule = require('@open-mercato/shared/lib/commands/registry') as CommandRegistryModule
    const endpointCatalogModule = require('../endpoint-catalog') as EndpointCatalogModule
    loaded = { serverContractModule, commandRegistryModule, endpointCatalogModule }
  })
  if (!loaded) throw new Error('[internal] failed to load server-output-contract in isolation')
  return loaded
}

const dealOutputSchema = z.object({
  dealId: z.string().uuid(),
  amount: z.number(),
})

describe('resolveServerOutputContract', () => {
  test('flattens a registered command outputSchema through UPDATE_ENTITY', () => {
    const { serverContractModule, commandRegistryModule } = loadIsolated()
    commandRegistryModule.commandRegistry.register({
      id: 'workflows.test.update_deal',
      execute: async () => ({ dealId: 'noop', amount: 0 }),
      outputSchema: dealOutputSchema,
    })
    try {
      const contract = serverContractModule.resolveServerOutputContract('UPDATE_ENTITY', {
        commandId: 'workflows.test.update_deal',
        input: {},
      })
      expect(contract).toEqual({
        entries: [
          { path: 'dealId', type: 'text' },
          { path: 'amount', type: 'number' },
        ],
      })
    } finally {
      commandRegistryModule.commandRegistry.clear()
    }
  })

  test("degrades to 'unknown' for unregistered commands, contract-less types, and unknown activity types", () => {
    const { serverContractModule } = loadIsolated()
    expect(
      serverContractModule.resolveServerOutputContract('UPDATE_ENTITY', {
        commandId: 'not.registered.command',
        input: {},
      }),
    ).toBe('unknown')
    expect(serverContractModule.resolveServerOutputContract('SEND_EMAIL', { to: 'x@y.z' })).toBe('unknown')
    expect(serverContractModule.resolveServerOutputContract('NOT_A_TYPE', {})).toBe('unknown')
  })

  test("degrades to 'unknown' when the command outputSchema root is not an object", () => {
    const { serverContractModule, commandRegistryModule } = loadIsolated()
    commandRegistryModule.commandRegistry.register({
      id: 'workflows.test.scalar_output',
      execute: async () => 'done',
      outputSchema: z.string(),
    })
    try {
      expect(
        serverContractModule.resolveServerOutputContract('UPDATE_ENTITY', {
          commandId: 'workflows.test.scalar_output',
          input: {},
        }),
      ).toBe('unknown')
    } finally {
      commandRegistryModule.commandRegistry.clear()
    }
  })

  test("types an async UPDATE_ENTITY activity's result entries in the ledger when the contract resolves", () => {
    const { serverContractModule, commandRegistryModule } = loadIsolated()
    commandRegistryModule.commandRegistry.register({
      id: 'workflows.test.update_deal',
      execute: async () => ({ dealId: 'noop', amount: 0 }),
      outputSchema: dealOutputSchema,
    })
    try {
      const definition: LedgerWorkflowDefinition = {
        steps: [
          { stepId: 'start', stepType: 'START' },
          {
            stepId: 'auto',
            stepType: 'AUTOMATED',
            activities: [
              {
                activityId: 'update_deal',
                activityType: 'UPDATE_ENTITY',
                config: { commandId: 'workflows.test.update_deal', input: {} },
                async: true,
              },
            ],
          },
          { stepId: 'end', stepType: 'END' },
        ],
        transitions: [
          { fromStepId: 'start', toStepId: 'auto' },
          { fromStepId: 'auto', toStepId: 'end' },
        ],
      }
      const ledger = computeContextLedger(definition, {
        resolveOutputContract: serverContractModule.resolveServerOutputContract,
      })
      const endEntries = ledger.steps.end.entries
      expect(endEntries).toEqual([
        expect.objectContaining({ path: 'update_deal_result.amount', type: 'number', presence: 'always' }),
        expect.objectContaining({ path: 'update_deal_result.dealId', type: 'text', presence: 'always' }),
      ])
      expect(ledger.steps.auto.entries).toEqual([])
    } finally {
      commandRegistryModule.commandRegistry.clear()
    }
  })
})

describe('resolveServerOutputContract for CALL_API', () => {
  const noopHandler = async () => new Response(null)

  const registerEndpointModules = () => {
    registerModules([
      {
        id: 'things',
        apis: [
          {
            path: '/things/[id]',
            handlers: { GET: noopHandler },
            docs: {
              methods: {
                GET: {
                  summary: 'Get thing',
                  responses: [
                    {
                      status: 200,
                      description: 'Success',
                      schema: z.object({ id: z.string(), amount: z.number() }),
                    },
                  ],
                },
              },
            },
          },
          {
            path: '/things/undocumented',
            handlers: { GET: noopHandler },
            docs: {
              methods: {
                GET: {
                  summary: 'Undeclared response',
                  responses: [{ status: 200, description: 'Success' }],
                },
              },
            },
          },
        ],
      } as unknown as Module,
    ])
  }

  test('flattens the picked endpoint declared response schema once the catalog is warmed', async () => {
    const { serverContractModule, endpointCatalogModule } = loadIsolated()
    registerEndpointModules()
    try {
      await endpointCatalogModule.getWorkflowEndpointCatalog()
      const contract = serverContractModule.resolveServerOutputContract('CALL_API', {
        endpoint: '/api/things/t-1',
        method: 'GET',
      })
      expect(contract).toEqual({
        entries: [
          { path: 'id', type: 'text' },
          { path: 'amount', type: 'number' },
        ],
      })
    } finally {
      endpointCatalogModule.clearWorkflowEndpointCatalogForTests()
    }
  })

  test('resolves endpoints whose path parameters are interpolation pills', async () => {
    const { serverContractModule, endpointCatalogModule } = loadIsolated()
    registerEndpointModules()
    try {
      await endpointCatalogModule.getWorkflowEndpointCatalog()
      const contract = serverContractModule.resolveServerOutputContract('CALL_API', {
        endpoint: '/api/things/{{context.thingId}}',
      })
      expect(contract).toEqual({
        entries: [
          { path: 'id', type: 'text' },
          { path: 'amount', type: 'number' },
        ],
      })
    } finally {
      endpointCatalogModule.clearWorkflowEndpointCatalogForTests()
    }
  })

  test("degrades to 'unknown' before the catalog is warmed", () => {
    const { serverContractModule } = loadIsolated()
    registerEndpointModules()
    expect(
      serverContractModule.resolveServerOutputContract('CALL_API', {
        endpoint: '/api/things/t-1',
        method: 'GET',
      }),
    ).toBe('unknown')
  })

  test("degrades to 'unknown' for unmatched endpoints, undeclared responses, and templated methods", async () => {
    const { serverContractModule, endpointCatalogModule } = loadIsolated()
    registerEndpointModules()
    try {
      await endpointCatalogModule.getWorkflowEndpointCatalog()
      expect(
        serverContractModule.resolveServerOutputContract('CALL_API', {
          endpoint: '/api/not/in/catalog',
          method: 'GET',
        }),
      ).toBe('unknown')
      expect(
        serverContractModule.resolveServerOutputContract('CALL_API', {
          endpoint: '/api/things/undocumented',
          method: 'GET',
        }),
      ).toBe('unknown')
      expect(
        serverContractModule.resolveServerOutputContract('CALL_API', {
          endpoint: '/api/things/t-1',
          method: '{{context.method}}',
        }),
      ).toBe('unknown')
      expect(serverContractModule.resolveServerOutputContract('CALL_API', { method: 'GET' })).toBe('unknown')
    } finally {
      endpointCatalogModule.clearWorkflowEndpointCatalogForTests()
    }
  })

  test('types a CALL_API activity result in the ledger through the seam', async () => {
    const { serverContractModule, endpointCatalogModule } = loadIsolated()
    registerEndpointModules()
    try {
      await endpointCatalogModule.getWorkflowEndpointCatalog()
      const definition: LedgerWorkflowDefinition = {
        steps: [
          { stepId: 'start', stepType: 'START' },
          { stepId: 'fetch', stepType: 'AUTOMATED' },
          { stepId: 'end', stepType: 'END' },
        ],
        transitions: [
          { fromStepId: 'start', toStepId: 'fetch' },
          {
            fromStepId: 'fetch',
            toStepId: 'end',
            activities: [
              {
                activityId: 'load_thing',
                activityType: 'CALL_API',
                activityName: 'load_thing',
                config: { endpoint: '/api/things/t-1', method: 'GET' },
              },
            ],
          },
        ],
      }
      const ledger = computeContextLedger(definition, {
        resolveOutputContract: serverContractModule.resolveServerOutputContract,
      })
      const endEntries = ledger.steps.end.entries
      expect(endEntries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'load_thing.id', type: 'text' }),
          expect.objectContaining({ path: 'load_thing.amount', type: 'number' }),
        ]),
      )
    } finally {
      endpointCatalogModule.clearWorkflowEndpointCatalogForTests()
    }
  })
})
