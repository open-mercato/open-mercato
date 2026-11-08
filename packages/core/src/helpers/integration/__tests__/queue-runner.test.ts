/** @jest-environment node */

import { bootstrapFromAppRoot } from '@open-mercato/shared/lib/bootstrap/dynamicLoader'
import { installNextSubpathResolveHook } from '@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook'
import { createQueue } from '@open-mercato/queue'
import { drainQueueFromAppRoot } from '../queue-runner'

const mockCallOrder: string[] = []

jest.mock('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook', () => ({
  installNextSubpathResolveHook: jest.fn(() => {
    mockCallOrder.push('installHook')
    return true
  }),
}))
jest.mock('@open-mercato/shared/lib/bootstrap/dynamicLoader', () => ({
  bootstrapFromAppRoot: jest.fn(async () => {
    mockCallOrder.push('bootstrap')
    return { modules: [{ workers: [{ queue: 'inbox-ops-attachments', handler: jest.fn() }] }] }
  }),
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: jest.fn() })),
}))
jest.mock('@open-mercato/queue', () => ({ createQueue: jest.fn() }))

describe('drainQueueFromAppRoot', () => {
  beforeEach(() => {
    jest.mocked(createQueue).mockReturnValue({
      process: jest.fn(async () => ({ processed: 0, failed: 0 })),
      close: jest.fn(async () => undefined),
    } as never)
  })

  it('installs the next/<subpath> resolve hook before bootstrapping the app, once per app root', async () => {
    await drainQueueFromAppRoot('inbox-ops-attachments', { appRoot: '/tmp/app-a', jobLimit: 10 })
    await drainQueueFromAppRoot('inbox-ops-attachments', { appRoot: '/tmp/app-a', jobLimit: 10 })

    expect(mockCallOrder).toEqual(['installHook', 'bootstrap'])
    expect(installNextSubpathResolveHook).toHaveBeenCalledTimes(1)
    expect(bootstrapFromAppRoot).toHaveBeenCalledWith('/tmp/app-a')
  })

  it('installs the hook (idempotent itself) before bootstrapping another app root', async () => {
    mockCallOrder.length = 0
    await drainQueueFromAppRoot('inbox-ops-attachments', { appRoot: '/tmp/app-b', jobLimit: 10 })

    expect(mockCallOrder).toEqual(['installHook', 'bootstrap'])
  })
})
