import type { AwilixContainer } from 'awilix'
import type { PhoneCallProviderAdapter } from '@open-mercato/shared/modules/phone_calls/provider'
import type { NormalizedPhoneCall } from '@open-mercato/shared/modules/phone_calls/types'
import { computeEnvFingerprint } from '../lib/operators-store'
import { runTillioPullJob, type TillioPullJobPayload } from '../lib/pull-job'

jest.mock('../lib/operators', () => ({
  ...jest.requireActual('../lib/operators'),
  resolveEnvironment: jest.fn(),
  readTillioIntegrationState: jest.fn(),
}))

jest.mock('../lib/operators-store', () => ({
  ...jest.requireActual('../lib/operators-store'),
  readOperatorsBlob: jest.fn(),
}))

const { resolveEnvironment, readTillioIntegrationState } = jest.requireMock('../lib/operators')
const { readOperatorsBlob } = jest.requireMock('../lib/operators-store')

const environment = { apiUrl: 'https://api.example.com', apiKey: 'key', tenantSystemId: 'OM-1' }

const operator = {
  id: 'op-1',
  plugin: 'Ringostat' as const,
  token: 'tok-1',
  tenantDomain: 'tenant.example.com',
  envFingerprint: computeEnvFingerprint(environment),
}

const payload: TillioPullJobPayload = {
  progressJobId: 'job-1',
  scope: { tenantId: 'tn', organizationId: 'org', userId: 'user-1' },
  from: '2026-08-01',
  to: '2026-08-02',
}

function call(externalCallId: string): NormalizedPhoneCall {
  return {
    externalCallId,
    direction: 'inbound',
    status: 'completed',
    participants: [],
    rawPayload: {},
    providerFacts: {},
  } as unknown as NormalizedPhoneCall
}

function createProgressService(overrides: Partial<Record<string, jest.Mock>> = {}) {
  return {
    startJob: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    markCancelled: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn().mockResolvedValue(false),
    ...overrides,
  }
}

function createContainer(services: Record<string, unknown>): AwilixContainer {
  return { resolve: (name: string) => services[name] } as unknown as AwilixContainer
}

function createAdapter(pages: Array<{ calls: NormalizedPhoneCall[]; nextCursor: string | null }>) {
  const fetchCalls = jest.fn(async () => pages.shift() ?? { calls: [], nextCursor: null })
  return { fetchCalls } as unknown as PhoneCallProviderAdapter & { fetchCalls: jest.Mock }
}

beforeEach(() => {
  resolveEnvironment.mockResolvedValue(environment)
  readTillioIntegrationState.mockResolvedValue({ enabled: true, healthy: true })
  readOperatorsBlob.mockResolvedValue({ operators: [operator], defaultOperatorId: operator.id })
})

describe('runTillioPullJob', () => {
  it('follows the provider cursor to the last page and completes the job', async () => {
    const progressService = createProgressService()
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: { created: true } }) }
    const adapter = createAdapter([
      { calls: [call('a'), call('b')], nextCursor: '2' },
      { calls: [call('c')], nextCursor: null },
    ])

    const summary = await runTillioPullJob({
      container: createContainer({
        progressService,
        commandBus,
        em: {},
        integrationCredentialsService: {},
      }),
      payload,
      adapter,
    })

    expect(summary).toMatchObject({ fetched: 3, created: 3, updated: 0, failed: 0, batches: 2 })
    expect(adapter.fetchCalls.mock.calls[0][0].cursor).toBeNull()
    expect(adapter.fetchCalls.mock.calls[1][0].cursor).toBe('2')
    expect(commandBus.execute).toHaveBeenCalledTimes(3)
    expect(progressService.completeJob).toHaveBeenCalledWith(
      'job-1',
      { resultSummary: expect.objectContaining({ fetched: 3 }) },
      expect.anything(),
    )
  })

  it('keeps ingesting the batch after a single call fails', async () => {
    const progressService = createProgressService()
    const commandBus = {
      execute: jest
        .fn()
        .mockResolvedValueOnce({ result: { created: true } })
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ result: { created: false } }),
    }
    const adapter = createAdapter([{ calls: [call('a'), call('b'), call('c')], nextCursor: null }])

    const summary = await runTillioPullJob({
      container: createContainer({
        progressService,
        commandBus,
        em: {},
        integrationCredentialsService: {},
      }),
      payload,
      adapter,
    })

    expect(summary).toMatchObject({ fetched: 3, created: 1, updated: 1, failed: 1 })
    expect(progressService.completeJob).toHaveBeenCalled()
  })

  it('stops before touching the provider when the job was cancelled', async () => {
    const progressService = createProgressService({
      isCancellationRequested: jest.fn().mockResolvedValue(true),
    })
    const adapter = createAdapter([{ calls: [call('a')], nextCursor: null }])

    const summary = await runTillioPullJob({
      container: createContainer({
        progressService,
        commandBus: { execute: jest.fn() },
        em: {},
        integrationCredentialsService: {},
      }),
      payload,
      adapter,
    })

    expect(summary.cancelled).toBe(true)
    expect(adapter.fetchCalls).not.toHaveBeenCalled()
    expect(progressService.markCancelled).toHaveBeenCalledWith('job-1', expect.anything())
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })

  it('fails the job without pulling when the operator was detached while it waited', async () => {
    readOperatorsBlob.mockResolvedValue({ operators: [], defaultOperatorId: null })
    const progressService = createProgressService()
    const adapter = createAdapter([{ calls: [call('a')], nextCursor: null }])

    await runTillioPullJob({
      container: createContainer({
        progressService,
        commandBus: { execute: jest.fn() },
        em: {},
        integrationCredentialsService: {},
      }),
      payload,
      adapter,
    })

    expect(adapter.fetchCalls).not.toHaveBeenCalled()
    expect(progressService.failJob).toHaveBeenCalledWith(
      'job-1',
      { errorMessage: 'operator_missing' },
      expect.anything(),
    )
  })
})
