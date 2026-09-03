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
          { path: 'executed', type: 'boolean' },
          { path: 'commandId', type: 'text' },
          { path: 'logEntryId', type: 'text' },
          { path: 'result.dealId', type: 'text' },
          { path: 'result.amount', type: 'number' },
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

  test('types a scalar command output as the envelope result key', () => {
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
      ).toEqual({
        entries: [
          { path: 'executed', type: 'boolean' },
          { path: 'commandId', type: 'text' },
          { path: 'logEntryId', type: 'text' },
          { path: 'result', type: 'text' },
        ],
      })
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
        expect.objectContaining({ path: 'update_deal_result.commandId', type: 'text', presence: 'always' }),
        expect.objectContaining({ path: 'update_deal_result.executed', type: 'boolean', presence: 'always' }),
        expect.objectContaining({ path: 'update_deal_result.logEntryId', type: 'text', presence: 'always' }),
        expect.objectContaining({ path: 'update_deal_result.result.amount', type: 'number', presence: 'always' }),
        expect.objectContaining({ path: 'update_deal_result.result.dealId', type: 'text', presence: 'always' }),
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

describe('resolveServerOutputContract for INVOKE_AGENT', () => {
  const riskOutcome = z.object({ score: z.number(), rationale: z.string() })

  const bridgeContainer = (bridge: unknown) => ({
    resolve: <T,>(name: string): T => {
      if (name !== 'agentWorkflowBridge' || bridge === undefined) {
        throw new Error(`[internal] ${name} is not registered`)
      }
      return bridge as T
    },
  })

  test('types the agent envelope from the optional peer OUTCOME contracts', async () => {
    const { serverContractModule } = loadIsolated()
    await serverContractModule.ensureWorkflowAgentOutcomeContracts(
      bridgeContainer({
        listAgentOutcomeContracts: async () => [
          { agentId: 'risk.scorer', resultKind: 'proposal', schema: riskOutcome },
        ],
      }),
    )
    try {
      expect(
        serverContractModule.resolveServerOutputContract('INVOKE_AGENT', { agentId: 'risk.scorer' }),
      ).toEqual({
        entries: [
          { path: 'kind', type: 'text' },
          { path: 'disposition', type: 'text' },
          { path: 'agentId', type: 'text' },
          { path: 'proposalId', type: 'text' },
          { path: 'proposalPayload.score', type: 'number' },
          { path: 'proposalPayload.rationale', type: 'text' },
        ],
      })
    } finally {
      serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
    }
  })

  test('puts a researcher agent OUTCOME under the envelope data key', async () => {
    const { serverContractModule } = loadIsolated()
    await serverContractModule.ensureWorkflowAgentOutcomeContracts(
      bridgeContainer({
        listAgentOutcomeContracts: async () => [
          { agentId: 'deals.summary', resultKind: 'researcher', schema: z.object({ summary: z.string() }) },
        ],
      }),
    )
    try {
      const contract = serverContractModule.resolveServerOutputContract('INVOKE_AGENT', {
        agentId: 'deals.summary',
      })
      expect(contract).not.toBe('unknown')
      expect(contract).toMatchObject({
        entries: expect.arrayContaining([{ path: 'data.summary', type: 'text' }]),
      })
    } finally {
      serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
    }
  })

  test("degrades to 'unknown' without the peer, before warm-up, and for unknown or templated agent ids", async () => {
    const { serverContractModule } = loadIsolated()
    expect(serverContractModule.resolveServerOutputContract('INVOKE_AGENT', { agentId: 'risk.scorer' })).toBe(
      'unknown',
    )
    await serverContractModule.ensureWorkflowAgentOutcomeContracts(bridgeContainer(undefined))
    try {
      expect(serverContractModule.resolveServerOutputContract('INVOKE_AGENT', { agentId: 'risk.scorer' })).toBe(
        'unknown',
      )
    } finally {
      serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
    }

    const second = loadIsolated().serverContractModule
    await second.ensureWorkflowAgentOutcomeContracts(
      bridgeContainer({
        listAgentOutcomeContracts: async () => [
          { agentId: 'risk.scorer', resultKind: 'proposal', schema: riskOutcome },
        ],
      }),
    )
    try {
      expect(second.resolveServerOutputContract('INVOKE_AGENT', { agentId: 'other.agent' })).toBe('unknown')
      expect(second.resolveServerOutputContract('INVOKE_AGENT', { agentId: '{{context.agentId}}' })).toBe('unknown')
      expect(second.resolveServerOutputContract('INVOKE_AGENT', {})).toBe('unknown')
    } finally {
      second.clearWorkflowAgentOutcomeContractsForTests()
    }
  })

  test('survives a peer whose contract listing throws', async () => {
    const { serverContractModule } = loadIsolated()
    await serverContractModule.ensureWorkflowAgentOutcomeContracts(
      bridgeContainer({
        listAgentOutcomeContracts: async () => {
          throw new Error('[internal] registry unavailable')
        },
      }),
    )
    try {
      expect(serverContractModule.resolveServerOutputContract('INVOKE_AGENT', { agentId: 'risk.scorer' })).toBe(
        'unknown',
      )
    } finally {
      serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
    }
  })

  test('types INVOKE_AGENT mapping targets in the ledger through the seam', async () => {
    const { serverContractModule } = loadIsolated()
    await serverContractModule.ensureWorkflowAgentOutcomeContracts(
      bridgeContainer({
        listAgentOutcomeContracts: async () => [
          { agentId: 'risk.scorer', resultKind: 'proposal', schema: riskOutcome },
        ],
      }),
    )
    try {
      const definition: LedgerWorkflowDefinition = {
        steps: [
          { stepId: 'start', stepType: 'START' },
          {
            stepId: 'agent',
            stepType: 'AUTOMATED',
            activities: [
              {
                activityId: 'invoke-risk',
                activityType: 'INVOKE_AGENT',
                config: { agentId: 'risk.scorer', outputMapping: { riskScore: 'proposalPayload.score' } },
              },
            ],
          },
          { stepId: 'end', stepType: 'END' },
        ],
        transitions: [
          { fromStepId: 'start', toStepId: 'agent' },
          { fromStepId: 'agent', toStepId: 'end' },
        ],
      }
      const ledger = computeContextLedger(definition, {
        resolveOutputContract: serverContractModule.resolveServerOutputContract,
      })
      expect(ledger.steps.end.entries).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: 'riskScore', type: 'number', presence: 'maybe' }),
        ]),
      )
    } finally {
      serverContractModule.clearWorkflowAgentOutcomeContractsForTests()
    }
  })
})
