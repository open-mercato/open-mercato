import type { EntityManager } from '@mikro-orm/postgresql'
import {
  getOcrConcurrencyStateForTests,
  requestOcrProcessing,
  resetOcrConcurrencyStateForTests,
  withOcrConcurrencySlot,
} from '../ocrQueue'
import type { Attachment } from '../../data/entities'
import type { StorageDriver } from '../drivers/types'
import { extractAttachmentContent } from '../textExtraction'

jest.mock('../textExtraction', () => ({
  extractAttachmentContent: jest.fn(async () => null),
}))

const extractAttachmentContentMock = extractAttachmentContent as jest.MockedFunction<
  typeof extractAttachmentContent
>

const makeAttachment = (): Attachment =>
  ({
    id: 'attachment-1',
    mimeType: 'application/pdf',
    partitionCode: 'docs',
    organizationId: 'org-1',
    tenantId: 'tenant-1',
  }) as unknown as Attachment

const driver = {} as StorageDriver

describe('requestOcrProcessing EntityManager isolation', () => {
  let setImmediateSpy: jest.SpyInstance

  beforeEach(() => {
    resetOcrConcurrencyStateForTests()
    extractAttachmentContentMock.mockReset()
    extractAttachmentContentMock.mockResolvedValue(null)
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    setImmediateSpy.mockRestore()
    resetOcrConcurrencyStateForTests()
  })

  it('forks the EntityManager for the background worker instead of reusing the request EM', async () => {
    const forkedEm = { id: 'forked' } as unknown as EntityManager
    const fork = jest.fn(() => forkedEm)
    const requestEm = { fork } as unknown as EntityManager

    await expect(
      requestOcrProcessing(requestEm, makeAttachment(), driver, 'docs/attachment-1.pdf'),
    ).resolves.toBe('queued')

    expect(fork).toHaveBeenCalledTimes(1)
    expect(setImmediateSpy).toHaveBeenCalledTimes(1)
  })

  it('throws loudly when the EntityManager cannot fork instead of silently reusing it', async () => {
    const requestEm = {} as unknown as EntityManager

    await expect(
      requestOcrProcessing(requestEm, makeAttachment(), driver, 'docs/attachment-1.pdf'),
    ).rejects.toThrow(/requires an EntityManager that exposes fork/)

    expect(setImmediateSpy).not.toHaveBeenCalled()
  })
})

describe('withOcrConcurrencySlot', () => {
  const previousConcurrency = process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY
  const previousWaitQueue = process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE

  beforeEach(() => {
    resetOcrConcurrencyStateForTests()
    process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = '1'
    delete process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE
  })

  afterEach(() => {
    if (previousConcurrency === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY
    else process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = previousConcurrency
    if (previousWaitQueue === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE
    else process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE = previousWaitQueue
    resetOcrConcurrencyStateForTests()
  })

  it('holds excess work until an active slot frees', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withOcrConcurrencySlot(async () => {
      await firstGate
      return 'first'
    })

    // Let the first slot become active before queuing the second.
    await Promise.resolve()
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 1, waiting: 0 })

    let secondStarted = false
    const second = withOcrConcurrencySlot(async () => {
      secondStarted = true
      return 'second'
    })

    await Promise.resolve()
    expect(secondStarted).toBe(false)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 1, waiting: 1 })

    releaseFirst()
    await expect(first).resolves.toBe('first')
    await expect(second).resolves.toBe('second')
    expect(secondStarted).toBe(true)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 0, waiting: 0 })
  })

  it('never exceeds OM_ATTACHMENT_OCR_MAX_CONCURRENCY active slots when three jobs compete', async () => {
    let maxActiveSeen = 0
    const trackActive = () => {
      maxActiveSeen = Math.max(maxActiveSeen, getOcrConcurrencyStateForTests().active)
    }

    const releaseGates: Array<() => void> = []
    const gates = [0, 1, 2].map(
      () =>
        new Promise<void>((resolve) => {
          releaseGates.push(resolve)
        }),
    )

    const jobs = gates.map((gate, index) =>
      withOcrConcurrencySlot(async () => {
        trackActive()
        await gate
        return index
      }),
    )

    await Promise.resolve()
    trackActive()

    releaseGates.forEach((release) => release())
    await expect(Promise.all(jobs)).resolves.toEqual([0, 1, 2])
    expect(maxActiveSeen).toBeLessThanOrEqual(1)
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 0, waiting: 0 })
  })
})

describe('requestOcrProcessing wait queue cap', () => {
  let setImmediateSpy: jest.SpyInstance
  const previousConcurrency = process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY

  beforeEach(() => {
    resetOcrConcurrencyStateForTests()
    process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = '1'
    process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE = '1'
    extractAttachmentContentMock.mockReset()
    extractAttachmentContentMock.mockResolvedValue('inline-extracted text')
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    setImmediateSpy.mockRestore()
    delete process.env.OM_ATTACHMENT_OCR_MAX_WAIT_QUEUE
    if (previousConcurrency === undefined) delete process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY
    else process.env.OM_ATTACHMENT_OCR_MAX_CONCURRENCY = previousConcurrency
    resetOcrConcurrencyStateForTests()
  })

  it('falls back to inline text extraction when the wait queue is full', async () => {
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    void withOcrConcurrencySlot(async () => {
      await firstGate
    })
    await Promise.resolve()
    void withOcrConcurrencySlot(async () => 'queued')
    await Promise.resolve()
    expect(getOcrConcurrencyStateForTests()).toEqual({ active: 1, waiting: 1 })

    const attachmentRow = { id: 'attachment-1', content: null as string | null }
    const forkedEm = {
      findOne: jest.fn(async () => attachmentRow),
      persist: jest.fn(),
      flush: jest.fn(async () => undefined),
    }
    forkedEm.persist.mockImplementation(() => forkedEm)
    const requestEm = {
      fork: jest.fn(() => forkedEm),
    } as unknown as EntityManager

    const overflowDriver = {
      toLocalPath: jest.fn(async () => ({
        filePath: '/tmp/attachment-1.pdf',
        cleanup: jest.fn(async () => undefined),
      })),
    } as unknown as StorageDriver

    await expect(
      requestOcrProcessing(requestEm, makeAttachment(), overflowDriver, 'docs/attachment-1.pdf'),
    ).resolves.toBe('inline_fallback')

    expect(setImmediateSpy).not.toHaveBeenCalled()
    expect(extractAttachmentContentMock).toHaveBeenCalledWith({
      filePath: '/tmp/attachment-1.pdf',
      mimeType: 'application/pdf',
    })
    expect(attachmentRow.content).toBe('inline-extracted text')
    expect(forkedEm.persist).toHaveBeenCalledWith(attachmentRow)
    expect(forkedEm.flush).toHaveBeenCalled()

    releaseFirst()
  })
})
