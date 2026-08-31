/** @jest-environment node */
// `opencode` is the deprecated predecessor label of `business-harness`. Third-party
// modules and historical registry entries still carry it, and the union is
// ADDITIVE-ONLY, so it MUST reach the harness runner. Falling through to the native
// runner would silently execute a file-defined agent on a different engine.
jest.setTimeout(60_000)

const businessHarnessRun = jest.fn(async () => ({ kind: 'researcher', data: { ok: true } }))
const nativeRun = jest.fn(async () => ({ kind: 'researcher', data: { ok: true } }))

jest.mock('../lib/runtime/businessHarnessAgentRunner', () => ({
  BusinessHarnessAgentRunner: class {
    run(...args: unknown[]) {
      return businessHarnessRun(...(args as []))
    }
  },
}))
jest.mock('../lib/runtime/nativeAgentRunner', () => ({
  DEFAULT_CONTEXT_TOKEN_BUDGET: 1000,
  NativeAgentRunner: class {
    run(...args: unknown[]) {
      return nativeRun(...(args as []))
    }
  },
}))

import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import { AgentRuntimeService } from '../lib/runtime/agentRuntime'
import {
  BUSINESS_HARNESS_RUNTIME_VALUES,
  isBusinessHarnessRuntime,
  registerFileAgent,
  type AgentRuntime,
} from '../lib/sdk/defineAgent'

const TENANT = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const USER = '44444444-4444-4444-8444-444444444444'

function register(id: string, runtime: AgentRuntime) {
  registerFileAgent({
    id,
    moduleId: 'agent_examples',
    resultKind: 'researcher',
    schema: z.object({ ok: z.boolean() }),
    tools: [],
    skills: [],
    subAgents: [],
    label: id,
    description: id,
    instructions: 'do the thing',
    runtime,
  })
}

function service() {
  return new AgentRuntimeService({
    container: { resolve: () => ({}) } as unknown as AwilixContainer,
    commandBus: {} as never,
  })
}

async function dispatch(id: string) {
  return service().run(id, {}, { tenantId: TENANT, organizationId: ORG, userId: USER, source: 'test' } as never)
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('business harness runtime dispatch', () => {
  it('treats business-harness and its deprecated opencode alias as one cohort', () => {
    expect([...BUSINESS_HARNESS_RUNTIME_VALUES]).toEqual(['business-harness', 'opencode'])
    expect(isBusinessHarnessRuntime('business-harness')).toBe(true)
    expect(isBusinessHarnessRuntime('opencode')).toBe(true)
    expect(isBusinessHarnessRuntime('native')).toBe(false)
    expect(isBusinessHarnessRuntime(null)).toBe(false)
  })

  it('runs a business-harness agent on the harness runner', async () => {
    register('dispatch.harness', 'business-harness')
    await dispatch('dispatch.harness')
    expect(businessHarnessRun).toHaveBeenCalledTimes(1)
    expect(nativeRun).not.toHaveBeenCalled()
  })

  it('runs a legacy opencode agent on the harness runner, not the native one', async () => {
    register('dispatch.legacy', 'opencode')
    await dispatch('dispatch.legacy')
    expect(businessHarnessRun).toHaveBeenCalledTimes(1)
    expect(nativeRun).not.toHaveBeenCalled()
  })

  it('still routes native and in-process agents to the native runner', async () => {
    register('dispatch.native', 'native')
    register('dispatch.legacy-native', 'in-process')
    await dispatch('dispatch.native')
    await dispatch('dispatch.legacy-native')
    expect(nativeRun).toHaveBeenCalledTimes(2)
    expect(businessHarnessRun).not.toHaveBeenCalled()
  })

  it('refuses to execute an external agent instead of guessing a runner', async () => {
    register('dispatch.external', 'external')
    await expect(dispatch('dispatch.external')).rejects.toThrow('not executable')
    expect(businessHarnessRun).not.toHaveBeenCalled()
    expect(nativeRun).not.toHaveBeenCalled()
  })
})
