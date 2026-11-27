/** @jest-environment node */
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { AgentRegistryEntry } from '../lib/sdk/defineAgent'
import type { AgentRunCtx } from '../lib/runtime/persistence'

const registeredEntries = new Map<string, AgentRegistryEntry>()
const openCodeRun = jest.fn(async () => ({ kind: 'research', data: { via: 'opencode' } }))
const nativeRun = jest.fn(async () => ({ kind: 'research', data: { via: 'native' } }))
const enforceAgentInvocable = jest.fn(async () => undefined)

jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => undefined),
  getAgentEntry: (id: string) => registeredEntries.get(id),
}))

jest.mock('../lib/runtime/openCodeAgentRunner', () => ({
  OpenCodeAgentRunner: jest.fn().mockImplementation(() => ({ run: openCodeRun })),
}))

jest.mock('../lib/runtime/nativeAgentRunner', () => ({
  NativeAgentRunner: jest.fn().mockImplementation(() => ({ run: nativeRun })),
  DEFAULT_CONTEXT_TOKEN_BUDGET: 0,
}))

jest.mock('../lib/access/agentInvokeAccess', () => ({
  enforceAgentInvocable: (...args: unknown[]) => enforceAgentInvocable(...(args as [])),
}))

jest.mock('../lib/identity/resolveRunAsForAgent', () => ({
  resolveRunAsForAgent: jest.fn(async () => null),
}))

jest.mock('../lib/runtime/admission', () => ({
  acquireAgentRunSlot: jest.fn(async () => () => undefined),
}))

import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import { AgentCallSettingsUnsupportedError, AgentInvokeDeniedError } from '../lib/runtime/errors'

function entry(id: string, runtime: AgentRegistryEntry['runtime']): AgentRegistryEntry {
  return {
    id,
    moduleId: 'agent_orchestrator',
    resultKind: 'research',
    schema: z.unknown(),
    tools: [],
    skills: [],
    subAgents: [],
    label: id,
    description: id,
    instructions: 'BASE',
    runtime,
  }
}

const ctx: AgentRunCtx = {
  tenantId: 'tenant-1',
  organizationId: 'org-1',
  userId: 'user-1',
}

function service() {
  return new AgentRuntimeService({
    container: { resolve: () => ({ fork: () => ({}) }) } as unknown as AwilixContainer,
    commandBus: {} as never,
  })
}

beforeEach(() => {
  jest.clearAllMocks()
  registeredEntries.clear()
  registeredEntries.set('test.file', entry('test.file', 'opencode'))
  registeredEntries.set('test.native', entry('test.native', 'native'))
})

describe('AgentRuntimeService — per-call model settings', () => {
  it('refuses callSettings for an OpenCode agent before the runner starts', async () => {
    await expect(service().run('test.file', {}, { ...ctx, callSettings: { temperature: 0 } })).rejects.toBeInstanceOf(
      AgentCallSettingsUnsupportedError,
    )
    expect(openCodeRun).not.toHaveBeenCalled()
  })

  it('runs an OpenCode agent normally when no callSettings are set', async () => {
    await service().run('test.file', {}, { ...ctx, callSettings: {} })
    expect(openCodeRun).toHaveBeenCalledTimes(1)
  })

  it('passes callSettings through to the native runner', async () => {
    await service().run('test.native', {}, { ...ctx, callSettings: { seed: 5 } })
    expect(nativeRun).toHaveBeenCalledTimes(1)
    const runCtx = (nativeRun.mock.calls[0] as unknown[])[3] as AgentRunCtx
    expect(runCtx.callSettings).toEqual({ seed: 5 })
  })

  it('checks invoke access first, so a denied caller learns nothing about the runtime', async () => {
    enforceAgentInvocable.mockRejectedValueOnce(new AgentInvokeDeniedError('test.file'))
    await expect(service().run('test.file', {}, { ...ctx, callSettings: { temperature: 0 } })).rejects.toBeInstanceOf(
      AgentInvokeDeniedError,
    )
  })
})
