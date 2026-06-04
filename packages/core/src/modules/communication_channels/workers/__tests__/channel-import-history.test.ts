// Spec B § Phase B6 — channel-import-history worker tests.

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))
jest.mock('../../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: jest.fn(async ({ credentials }) => ({ credentials })),
}))

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import handler, { metadata } from '../channel-import-history'
import type { QueuedJob } from '@open-mercato/queue'
import type { ChannelImportHistoryJobPayload } from '../../commands/queue-import-history'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const CHANNEL = '33333333-3333-4333-8333-333333333333'

function buildJob(overrides: Partial<ChannelImportHistoryJobPayload> = {}): QueuedJob<ChannelImportHistoryJobPayload> {
  return {
    id: 'job-1',
    createdAt: new Date().toISOString(),
    payload: {
      progressJobId: 'progress-1',
      channelId: CHANNEL,
      sinceDays: 30,
      contactEmails: undefined,
      maxMessages: 1000,
      scope: { tenantId: TENANT, organizationId: ORG },
      ...overrides,
    },
  } as QueuedJob<ChannelImportHistoryJobPayload>
}

function buildChannel() {
  return {
    id: CHANNEL,
    providerKey: 'imap',
    channelType: 'email',
    displayName: 'Mailbox',
    externalIdentifier: 'me@example.com',
    isActive: true,
    status: 'connected',
    userId: null,
    credentialsRef: null,
  }
}

function buildCtx(args: {
  importHistory?: jest.Mock
  isCancelled?: () => Promise<boolean>
  commandExecute?: jest.Mock
}) {
  const progressService = {
    startJob: jest.fn().mockResolvedValue(undefined),
    updateProgress: jest.fn().mockResolvedValue(undefined),
    completeJob: jest.fn().mockResolvedValue(undefined),
    failJob: jest.fn().mockResolvedValue(undefined),
    markCancelled: jest.fn().mockResolvedValue(undefined),
    isCancellationRequested: jest.fn(args.isCancelled ?? (() => Promise.resolve(false))),
  }
  const commandBus = { execute: args.commandExecute ?? jest.fn().mockResolvedValue({}) }
  const adapterRegistry = {
    get: () =>
      args.importHistory
        ? { providerKey: 'imap', importHistory: args.importHistory }
        : { providerKey: 'imap' },
  }
  const em = { fork: () => ({}) }
  const ctx = {
    jobId: 'job-1',
    attemptNumber: 1,
    queueName: 'communication-channels-import-history',
    resolve: ((name: string) => {
      if (name === 'em') return em
      if (name === 'progressService') return progressService
      if (name === 'commandBus') return commandBus
      if (name === 'channelAdapterRegistry') return adapterRegistry
      if (name === 'integrationCredentialsService') throw new Error('no creds')
      return null
    }) as <T>(name: string) => T,
  }
  return { ctx, progressService, commandBus }
}

afterEach(() => jest.clearAllMocks())

describe('channel-import-history worker metadata', () => {
  it('targets the import-history queue with concurrency 1', () => {
    expect(metadata.queue).toBe('communication-channels-import-history')
    expect(metadata.concurrency).toBe(1)
  })
})

describe('channel-import-history worker', () => {
  it('fails the progress job when the channel is missing', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(null)
    const { ctx, progressService } = buildCtx({})
    await handler(buildJob(), ctx as never)
    expect(progressService.failJob).toHaveBeenCalledWith(
      'progress-1',
      expect.objectContaining({ errorMessage: 'Channel not found' }),
      expect.any(Object),
    )
  })

  it('fails the progress job when the channel is not connected', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue({ ...buildChannel(), status: 'error' })
    const { ctx, progressService } = buildCtx({})
    await handler(buildJob(), ctx as never)
    expect(progressService.failJob).toHaveBeenCalledWith(
      'progress-1',
      expect.objectContaining({ errorMessage: expect.stringContaining('not connected') }),
      expect.any(Object),
    )
  })

  it('fails the progress job when the adapter does not implement importHistory', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const { ctx, progressService } = buildCtx({}) // importHistory: undefined
    await handler(buildJob(), ctx as never)
    expect(progressService.failJob).toHaveBeenCalledWith(
      'progress-1',
      expect.objectContaining({ errorMessage: expect.stringContaining('does not support history import') }),
      expect.any(Object),
    )
  })

  it('drains pages, dispatches ingest command per message, completes the job', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const importHistory = jest
      .fn()
      .mockResolvedValueOnce({
        messages: [
          { externalMessageId: 'm1' },
          { externalMessageId: 'm2' },
        ],
        nextCursor: 'page2',
        hasMore: true,
        totalCandidates: 3,
      })
      .mockResolvedValueOnce({
        messages: [{ externalMessageId: 'm3' }],
        hasMore: false,
      })
    const { ctx, progressService, commandBus } = buildCtx({ importHistory })
    await handler(buildJob(), ctx as never)

    expect(importHistory).toHaveBeenCalledTimes(2)
    expect(importHistory.mock.calls[1][0].cursor).toBe('page2')
    expect(commandBus.execute).toHaveBeenCalledTimes(3)
    expect(progressService.completeJob).toHaveBeenCalledWith(
      'progress-1',
      expect.objectContaining({
        resultSummary: expect.objectContaining({ importedCount: 3, channelId: CHANNEL }),
      }),
      expect.any(Object),
    )
    expect(progressService.failJob).not.toHaveBeenCalled()
  })

  it('uses totalCandidates from the first page as ProgressJob.totalCount', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const importHistory = jest.fn().mockResolvedValueOnce({
      messages: [],
      hasMore: false,
      totalCandidates: 17,
    })
    const { ctx, progressService } = buildCtx({ importHistory })
    await handler(buildJob({ maxMessages: 1000 }), ctx as never)
    const totalUpdates = (progressService.updateProgress as jest.Mock).mock.calls.filter(
      ([, input]: any[]) => input?.totalCount === 17,
    )
    expect(totalUpdates.length).toBeGreaterThan(0)
  })

  it('honors the maxMessages cap mid-page', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const importHistory = jest.fn().mockResolvedValue({
      messages: Array.from({ length: 10 }, (_v, i) => ({ externalMessageId: `m${i}` })),
      hasMore: true,
      nextCursor: 'never-used',
    })
    const { ctx, progressService, commandBus } = buildCtx({ importHistory })
    await handler(buildJob({ maxMessages: 4 }), ctx as never)
    expect(commandBus.execute).toHaveBeenCalledTimes(4) // cap respected
    expect(progressService.completeJob).toHaveBeenCalled()
  })

  it('marks the job cancelled when cancellation is requested', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const importHistory = jest.fn()
    const { ctx, progressService } = buildCtx({
      importHistory,
      isCancelled: () => Promise.resolve(true),
    })
    await handler(buildJob(), ctx as never)
    expect(progressService.markCancelled).toHaveBeenCalledWith('progress-1', expect.any(Object))
    expect(importHistory).not.toHaveBeenCalled()
    expect(progressService.completeJob).not.toHaveBeenCalled()
  })

  it('records failJob and rethrows when adapter throws an unexpected error', async () => {
    ;(findOneWithDecryption as jest.Mock).mockResolvedValue(buildChannel())
    const importHistory = jest.fn().mockRejectedValue(new Error('imap connection reset'))
    const { ctx, progressService } = buildCtx({ importHistory })
    await expect(handler(buildJob(), ctx as never)).rejects.toThrow('imap connection reset')
    expect(progressService.failJob).toHaveBeenCalledWith(
      'progress-1',
      expect.objectContaining({ errorMessage: expect.stringContaining('imap connection reset') }),
      expect.any(Object),
    )
  })
})
