import type { EntityManager } from '@mikro-orm/postgresql'
import { requestOcrProcessing } from '../ocrQueue'
import type { Attachment } from '../../data/entities'
import type { StorageDriver } from '../drivers/types'

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
    setImmediateSpy = jest.spyOn(global, 'setImmediate').mockImplementation((() => undefined) as never)
  })

  afterEach(() => {
    setImmediateSpy.mockRestore()
  })

  it('forks the EntityManager for the background worker instead of reusing the request EM', async () => {
    const forkedEm = { id: 'forked' } as unknown as EntityManager
    const fork = jest.fn(() => forkedEm)
    const requestEm = { fork } as unknown as EntityManager

    await requestOcrProcessing(requestEm, makeAttachment(), driver, 'docs/attachment-1.pdf')

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
