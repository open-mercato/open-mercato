// Spec B § Phase B6 — concurrency guard + adapter capability + ProgressJob wiring.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/adapter-registry-singleton', () => ({
  getChannelAdapterRegistry: jest.fn(),
}))
jest.mock('../../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { importHistory: 'communication-channels-import-history' },
  getCommunicationChannelsQueue: jest.fn(),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getChannelAdapterRegistry } from '../../lib/adapter-registry-singleton'
import { getCommunicationChannelsQueue } from '../../lib/queue'
import {
  queueImportHistory,
  queueImportHistorySchema,
  CHANNEL_IMPORT_HISTORY_JOB_TYPE,
} from '../queue-import-history'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const CHANNEL = '44444444-4444-4444-8444-444444444444'

function buildContainer(overrides: {
  progressJobs?: Array<Record<string, unknown>>
  createdJob?: { id: string }
  enqueueSpy?: jest.Mock
  createSpy?: jest.Mock
}) {
  const progressService = {
    getActiveJobs: jest.fn().mockResolvedValue(overrides.progressJobs ?? []),
    createJob: overrides.createSpy ?? jest.fn().mockResolvedValue(overrides.createdJob ?? { id: 'job-1' }),
  }
  const em = { fork: jest.fn().mockReturnValue({}) }
  const container = {
    resolve: jest.fn((token: string) => {
      if (token === 'em') return em
      if (token === 'progressService') return progressService
      throw new Error(`unexpected resolve: ${token}`)
    }),
  } as unknown as Parameters<typeof queueImportHistory>[0]['container']
  ;(getCommunicationChannelsQueue as jest.Mock).mockReturnValue({
    enqueue: overrides.enqueueSpy ?? jest.fn().mockResolvedValue('queued-id'),
  })
  return { container, progressService }
}

function buildConnectedChannel() {
  return {
    id: CHANNEL,
    providerKey: 'imap',
    displayName: 'My Mailbox',
    externalIdentifier: 'me@example.com',
    isActive: true,
    status: 'connected',
  }
}

afterEach(() => {
  jest.clearAllMocks()
})

describe('queueImportHistorySchema', () => {
  it('parses defaults', () => {
    const parsed = queueImportHistorySchema.parse({ channelId: CHANNEL })
    expect(parsed.sinceDays).toBe(30)
    expect(parsed.maxMessages).toBe(1000)
    expect(parsed.contactEmails).toBeUndefined()
  })

  it('clamps sinceDays to [1, 365]', () => {
    expect(() => queueImportHistorySchema.parse({ channelId: CHANNEL, sinceDays: 0 })).toThrow()
    expect(() => queueImportHistorySchema.parse({ channelId: CHANNEL, sinceDays: 366 })).toThrow()
  })

  it('rejects non-email contact entries', () => {
    expect(() =>
      queueImportHistorySchema.parse({ channelId: CHANNEL, contactEmails: ['not-an-email'] }),
    ).toThrow()
  })
})

describe('queueImportHistory', () => {
  it('returns 404 envelope when channel not found', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const { container } = buildContainer({})
    await expect(
      queueImportHistory({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL, sinceDays: 30, maxMessages: 100 },
      }),
    ).rejects.toMatchObject({ status: 404 })
  })

  it('returns 409 envelope when channel is not connected', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({
      ...buildConnectedChannel(),
      status: 'error',
    })
    const { container } = buildContainer({})
    await expect(
      queueImportHistory({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL, sinceDays: 30, maxMessages: 100 },
      }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it('returns 400 envelope when adapter has no importHistory method', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildConnectedChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: () => ({ providerKey: 'imap' }), // no importHistory
    })
    const { container } = buildContainer({})
    await expect(
      queueImportHistory({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL, sinceDays: 30, maxMessages: 100 },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('returns 429 envelope when another import is in flight for the same channel', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildConnectedChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: () => ({ providerKey: 'imap', importHistory: jest.fn() }),
    })
    const { container } = buildContainer({
      progressJobs: [
        { jobType: CHANNEL_IMPORT_HISTORY_JOB_TYPE, meta: { channelId: CHANNEL } },
      ],
    })
    await expect(
      queueImportHistory({
        container,
        scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
        input: { channelId: CHANNEL, sinceDays: 30, maxMessages: 100 },
      }),
    ).rejects.toMatchObject({ status: 429 })
  })

  it('ignores in-flight jobs for other channels', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildConnectedChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: () => ({ providerKey: 'imap', importHistory: jest.fn() }),
    })
    const enqueueSpy = jest.fn().mockResolvedValue('ok')
    const createSpy = jest.fn().mockResolvedValue({ id: 'progress-7' })
    const { container } = buildContainer({
      progressJobs: [
        { jobType: CHANNEL_IMPORT_HISTORY_JOB_TYPE, meta: { channelId: 'some-other-channel' } },
      ],
      createSpy,
      enqueueSpy,
    })
    const result = await queueImportHistory({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: { channelId: CHANNEL, sinceDays: 30, maxMessages: 100 },
    })
    expect(result.progressJobId).toBe('progress-7')
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
  })

  it('creates ProgressJob, enqueues payload, returns progressJobId on happy path', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildConnectedChannel())
    ;(getChannelAdapterRegistry as jest.Mock).mockReturnValue({
      get: () => ({ providerKey: 'imap', importHistory: jest.fn() }),
    })
    const enqueueSpy = jest.fn().mockResolvedValue('queued')
    const createSpy = jest.fn().mockResolvedValue({ id: 'progress-42' })
    const { container, progressService } = buildContainer({ createSpy, enqueueSpy })

    const result = await queueImportHistory({
      container,
      scope: { tenantId: TENANT, organizationId: ORG, userId: USER },
      input: {
        channelId: CHANNEL,
        sinceDays: 14,
        contactEmails: ['contact@example.com'],
        maxMessages: 250,
      },
    })

    expect(result).toEqual({ progressJobId: 'progress-42', totalCountHint: 250 })
    expect(progressService.createJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobType: CHANNEL_IMPORT_HISTORY_JOB_TYPE,
        totalCount: 250,
        meta: expect.objectContaining({
          channelId: CHANNEL,
          providerKey: 'imap',
          sinceDays: 14,
          contactEmailsCount: 1,
          maxMessages: 250,
        }),
      }),
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG, userId: USER }),
    )
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        progressJobId: 'progress-42',
        channelId: CHANNEL,
        sinceDays: 14,
        contactEmails: ['contact@example.com'],
        maxMessages: 250,
        scope: { tenantId: TENANT, organizationId: ORG },
      }),
    )
  })
})
