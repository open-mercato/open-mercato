/**
 * Unit tests for the token-usage recorder (R12 compliance).
 *
 * Verifies that `recordTokenUsage` never throws regardless of DB/emit failures,
 * and that a missing `tenantId` causes an early return without writing anything.
 *
 * Phase 6.3 of spec `2026-04-28-ai-agents-agentic-loop-controls`.
 */

import { recordTokenUsage, type RecordTokenUsageInput } from '../lib/token-usage-recorder'
import type { AwilixContainer } from 'awilix'

function makeInput(overrides: Partial<RecordTokenUsageInput> = {}): RecordTokenUsageInput {
  return {
    authContext: {
      tenantId: 'tenant-1',
      organizationId: null,
      userId: 'user-1',
    },
    agentId: 'catalog.assistant',
    moduleId: 'catalog',
    sessionId: '00000000-0000-0000-0000-000000000001',
    turnId: '00000000-0000-0000-0000-000000000002',
    stepIndex: 0,
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    usage: {
      inputTokens: 100,
      outputTokens: 50,
    },
    ...overrides,
  }
}

function makeContainer(options: {
  createEventThrows?: boolean
  upsertDailyThrows?: boolean
}): AwilixContainer {
  const createEvent = jest.fn(async () => {
    if (options.createEventThrows) throw new Error('DB write failed')
    return {}
  })
  const upsertDaily = jest.fn(async () => {
    if (options.upsertDailyThrows) throw new Error('Upsert failed')
  })

  const repoInstance = { createEvent, upsertDaily }

  const em = {
    fork: () => em,
  }

  const container: Partial<AwilixContainer> = {
    resolve: (name: string) => {
      if (name === 'em') return em as unknown as ReturnType<AwilixContainer['resolve']>
      throw new Error(`Unknown token: ${name}`)
    },
  }

  jest.mock('../data/repositories/AiTokenUsageRepository', () => ({
    AiTokenUsageRepository: jest.fn().mockImplementation(() => repoInstance),
  }))

  return container as AwilixContainer
}

describe('recordTokenUsage — R12 compliance', () => {
  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
  })

  it('never throws when createEvent throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const input = makeInput()
    const container = makeContainer({ createEventThrows: true })
    await expect(recordTokenUsage(input, container)).resolves.toBeUndefined()
    warnSpy.mockRestore()
  })

  it('never throws when upsertDaily throws', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const input = makeInput()
    const container = makeContainer({ upsertDailyThrows: true })
    await expect(recordTokenUsage(input, container)).resolves.toBeUndefined()
    warnSpy.mockRestore()
  })

  it('logs a warn when DB write fails', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const input = makeInput()
    const container = makeContainer({ createEventThrows: true })
    await recordTokenUsage(input, container)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[AI token-usage]'),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('returns immediately without writing when tenantId is falsy', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
    const input = makeInput({ authContext: { tenantId: null, organizationId: null, userId: 'user-1' } })
    const container = makeContainer({})
    await expect(recordTokenUsage(input, container)).resolves.toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
