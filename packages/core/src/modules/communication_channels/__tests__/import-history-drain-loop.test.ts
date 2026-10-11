const channelStub = {
  id: '11111111-1111-4111-8111-111111111111',
  providerKey: 'gmail',
  channelType: 'email',
  isActive: true,
  status: 'connected',
  userId: null,
  credentialsRef: null,
}

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: async () => channelStub,
  findWithDecryption: async () => [],
}))

jest.mock('../lib/credential-refresh', () => ({
  refreshCredentialsIfNeeded: async ({ credentials }: { credentials: Record<string, unknown> }) => ({ credentials }),
}))

jest.mock('../lib/queue', () => ({
  COMMUNICATION_CHANNELS_QUEUES: { importHistory: 'communication_channels.import_history' },
  getCommunicationChannelsQueue: () => ({ enqueue: async () => undefined }),
}))

import handleImportHistory from '../workers/channel-import-history'
import type { ImportHistoryInput, ImportHistoryPage } from '../lib/adapter'
import { IMPORT_HISTORY_MAX_EMPTY_PAGES } from '../lib/import-history-limits'

const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORG_ID = '33333333-3333-4333-8333-333333333333'
const PROGRESS_JOB_ID = '44444444-4444-4444-8444-444444444444'

type ProgressStub = {
  completed: boolean
  failures: string[]
}

function buildContext(
  importHistory: (input: ImportHistoryInput) => Promise<ImportHistoryPage>,
  progress: ProgressStub,
) {
  const progressService = {
    startJob: async () => undefined,
    isCancellationRequested: async () => false,
    markCancelled: async () => undefined,
    updateProgress: async () => undefined,
    completeJob: async () => {
      progress.completed = true
    },
    failJob: async (_id: string, payload: { errorMessage: string }) => {
      progress.failures.push(payload.errorMessage)
    },
  }
  const registry = { get: () => ({ importHistory }) }
  const commandBus = { execute: async () => undefined }
  const em = { fork: () => em }

  return {
    resolve: (name: string) => {
      if (name === 'progressService') return progressService
      if (name === 'em') return em
      if (name === 'channelAdapterRegistry') return registry
      if (name === 'commandBus') return commandBus
      throw new Error(`[internal] unexpected resolve(${name})`)
    },
  } as never
}

function buildJob(maxMessages: number) {
  return {
    payload: {
      progressJobId: PROGRESS_JOB_ID,
      channelId: channelStub.id,
      sinceDays: 3650,
      maxMessages,
      scope: { tenantId: TENANT_ID, organizationId: ORG_ID },
    },
  } as never
}

function message(index: number) {
  return {
    externalMessageId: `msg-${index}`,
    channelType: 'email',
    direction: 'inbound',
    senderIdentifier: 'sender@example.com',
    body: 'body',
    sentAt: new Date(),
  }
}

describe('channel-import-history drain loop', () => {
  it('drains well past the old 100-page ceiling for a large backfill', async () => {
    let pageCount = 0
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      return {
        messages: [message(pageCount)],
        nextCursor: `cursor-${pageCount}`,
        hasMore: true,
      }
    }, progress)

    await handleImportHistory(buildJob(500), ctx)

    expect(pageCount).toBe(500)
    expect(progress.completed).toBe(true)
  })

  it('runs an empty-page stretch to completion while the cursor keeps advancing', async () => {
    const emptyStretch = IMPORT_HISTORY_MAX_EMPTY_PAGES - 1
    let pageCount = 0
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      if (pageCount <= emptyStretch) {
        return { messages: [], nextCursor: `cursor-${pageCount}`, hasMore: true }
      }
      return { messages: [message(pageCount)], hasMore: false }
    }, progress)

    await handleImportHistory(buildJob(50000), ctx)

    expect(pageCount).toBe(emptyStretch + 1)
    expect(progress.completed).toBe(true)
    expect(progress.failures).toEqual([])
  })

  it('aborts immediately when the adapter repeats the cursor it was given', async () => {
    let pageCount = 0
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      return { messages: [message(pageCount)], nextCursor: 'stuck', hasMore: true }
    }, progress)

    await handleImportHistory(buildJob(50000), ctx)

    expect(pageCount).toBe(2)
    expect(progress.completed).toBe(false)
    expect(progress.failures).toHaveLength(1)
    expect(progress.failures[0]).toContain('repeated the same pagination cursor')
  })

  it('stops on a long run of empty pages and reports the import as cut short', async () => {
    let pageCount = 0
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      return { messages: [], nextCursor: `cursor-${pageCount}`, hasMore: true }
    }, progress)

    await handleImportHistory(buildJob(50000), ctx)

    expect(pageCount).toBe(IMPORT_HISTORY_MAX_EMPTY_PAGES)
    expect(progress.completed).toBe(false)
    expect(progress.failures[0]).toContain('consecutive pages')
  })

  it('resets the empty-page counter when the adapter makes progress again', async () => {
    let pageCount = 0
    const emptyRun = IMPORT_HISTORY_MAX_EMPTY_PAGES - 1
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      const lastPage = emptyRun * 2 + 2
      const yieldsMessage = pageCount === emptyRun + 1 || pageCount === lastPage
      return {
        messages: yieldsMessage ? [message(pageCount)] : [],
        nextCursor: pageCount === lastPage ? undefined : `cursor-${pageCount}`,
        hasMore: pageCount !== lastPage,
      } as ImportHistoryPage
    }, progress)

    await handleImportHistory(buildJob(50000), ctx)

    expect(pageCount).toBe(emptyRun * 2 + 2)
    expect(progress.completed).toBe(true)
    expect(progress.failures).toEqual([])
  })

  it('completes cleanly when the sweep genuinely finishes on an empty final page', async () => {
    let pageCount = 0
    const progress: ProgressStub = { completed: false, failures: [] }
    const ctx = buildContext(async () => {
      pageCount += 1
      if (pageCount === 1) {
        return { messages: [message(pageCount)], nextCursor: 'cursor-1', hasMore: true }
      }
      // The last page is empty and hasMore is false — a real end-of-sweep,
      // not a stuck adapter. This must not trip the empty-page guard.
      return { messages: [], hasMore: false }
    }, progress)

    await handleImportHistory(buildJob(50000), ctx)

    expect(pageCount).toBe(2)
    expect(progress.completed).toBe(true)
    expect(progress.failures).toEqual([])
  })
})
