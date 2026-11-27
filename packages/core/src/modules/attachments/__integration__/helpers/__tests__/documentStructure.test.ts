import type { APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { drainIntegrationQueue } from '@open-mercato/core/helpers/integration/queue'
import { extractAndWait, waitForStructure, type StructureBody } from '../documentStructure'

jest.mock('@open-mercato/core/modules/core/__integration__/helpers/api', () => ({ apiRequest: jest.fn() }))
jest.mock('@open-mercato/core/modules/core/__integration__/helpers/generalFixtures', () => ({
  readJsonSafe: (response: { json: () => Promise<unknown> }) => response.json(),
}))
jest.mock('@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures', () => ({
  uploadAttachmentFixture: jest.fn(),
}))
jest.mock('@open-mercato/core/helpers/integration/queue', () => ({ drainIntegrationQueue: jest.fn() }))

const request = {} as APIRequestContext
const token = 'test-token'
const attachmentId = 'test-attachment'

function completedStructure(extractionId = 'new-extraction'): StructureBody {
  return {
    attachmentId,
    extraction: { id: extractionId, status: 'completed', engine: 'text', pageCount: 1, sectionCount: 1, skipReason: null },
    outline: [],
  }
}

describe('document structure integration polling', () => {
  let current: StructureBody
  let queued: boolean

  beforeEach(() => {
    jest.resetAllMocks()
    jest.useFakeTimers()
    current = { attachmentId, extraction: null, outline: [] }
    queued = false
    jest.mocked(apiRequest).mockImplementation(async (_request, method) => {
      if (method === 'POST') queued = true
      return { status: () => method === 'POST' ? 202 : 200, json: async () => current } as Awaited<ReturnType<typeof apiRequest>>
    })
  })

  afterEach(() => { jest.useRealTimers() })

  async function finishPolling(pending: Promise<StructureBody>): Promise<StructureBody> {
    const result = pending.catch((error: unknown) => error)
    await jest.advanceTimersByTimeAsync(120_000)
    const body = await result
    if (body instanceof Error) throw body
    return body as StructureBody
  }

  it('processes the upload event before extraction when background workers are disabled', async () => {
    jest.mocked(drainIntegrationQueue).mockImplementation(async (queueName) => {
      if (queueName === 'events') queued = true
      if (queueName === 'attachments-document-structure' && queued) current = completedStructure()
      return 1
    })

    await expect(finishPolling(extractAndWait(request, token, attachmentId, {
      partitionCode: 'auto', partitionId: 'partition', autoExtract: true,
    }))).resolves.toEqual(completedStructure())
    expect(jest.mocked(apiRequest).mock.calls.every(([, method]) => method === 'GET')).toBe(true)
  })

  it('processes explicit extraction requests without automatic upload extraction', async () => {
    jest.mocked(drainIntegrationQueue).mockImplementation(async (queueName) => {
      if (queueName === 'attachments-document-structure' && queued) current = completedStructure()
      return 1
    })

    await expect(finishPolling(extractAndWait(request, token, attachmentId, {
      partitionCode: 'fallback', partitionId: null, autoExtract: false,
    }))).resolves.toEqual(completedStructure())
    expect(apiRequest).toHaveBeenCalledWith(request, 'POST', `/api/attachments/structure/${attachmentId}`, {
      token, data: { ocr: 'never' },
    })
  })

  it('waits for a new extraction when an earlier completed version is still visible', async () => {
    current = completedStructure('old-extraction')
    jest.mocked(drainIntegrationQueue).mockImplementation(async (queueName) => {
      if (queueName === 'attachments-document-structure') current = completedStructure()
      return 0
    })

    await expect(finishPolling(waitForStructure(request, token, attachmentId, {
      notExtractionId: 'old-extraction',
    }))).resolves.toEqual(completedStructure())
  })

  it('keeps polling the API when managed queues have already settled', async () => {
    current = completedStructure()
    jest.mocked(drainIntegrationQueue).mockResolvedValue(0)

    await expect(waitForStructure(request, token, attachmentId)).resolves.toEqual(current)
  })

  it('surfaces queue processing failures without treating them as an empty extraction', async () => {
    jest.mocked(drainIntegrationQueue).mockRejectedValue(new Error('[internal] extraction queue unavailable'))

    await expect(finishPolling(waitForStructure(request, token, attachmentId)))
      .rejects.toThrow('[internal] extraction queue unavailable')
  })
})
