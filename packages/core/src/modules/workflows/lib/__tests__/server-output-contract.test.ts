/** @jest-environment node */

import { describe, test, expect, jest } from '@jest/globals'
import { z } from 'zod'
import { computeContextLedger, type LedgerWorkflowDefinition } from '../context-ledger'

type ServerContractModule = typeof import('../server-output-contract')
type CommandRegistryModule = typeof import('@open-mercato/shared/lib/commands/registry')

type LoadedModules = {
  serverContractModule: ServerContractModule
  commandRegistryModule: CommandRegistryModule
}

const loadIsolated = (): LoadedModules => {
  let loaded: LoadedModules | undefined
  jest.isolateModules(() => {
    const serverContractModule = require('../server-output-contract') as ServerContractModule
    const commandRegistryModule = require('@open-mercato/shared/lib/commands/registry') as CommandRegistryModule
    loaded = { serverContractModule, commandRegistryModule }
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
