import { drainQueueFromAppRoot } from '../queue-runner'

const mockCalls: string[] = []

jest.mock('@open-mercato/shared/lib/bootstrap/next-subpath-resolve-hook', () => ({
  installNextSubpathResolveHook: () => { mockCalls.push('install-hook') },
}))
jest.mock('@open-mercato/shared/lib/bootstrap/dynamicLoader', () => ({
  bootstrapFromAppRoot: async () => {
    mockCalls.push('bootstrap')
    return { modules: [] }
  },
}))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/queue', () => ({ createQueue: jest.fn() }))

describe('drainQueueFromAppRoot', () => {
  it('installs the next/<subpath> resolve hook before bootstrapping the app', async () => {
    await drainQueueFromAppRoot('events', { appRoot: '/tmp/queue-runner-app', jobLimit: 1 })

    expect(mockCalls).toEqual(['install-hook', 'bootstrap'])
  })
})
