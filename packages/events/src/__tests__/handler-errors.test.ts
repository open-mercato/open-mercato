jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(() => ({
    enqueue: jest.fn(),
    clear: jest.fn(),
    close: jest.fn(),
  })),
}), { virtual: true })

const { createEventBus } = require('../bus')

describe('event handler error propagation', () => {
  const originalConsoleError = console.error

  beforeEach(() => {
    console.error = jest.fn()
  })

  afterEach(() => {
    console.error = originalConsoleError
  })

  it('keeps handler failures non-blocking by default', async () => {
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {})).resolves.toBeUndefined()
  })

  it('rejects the emit when rethrowHandlerErrors is enabled', async () => {
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {}, { rethrowHandlerErrors: true })).rejects.toThrow('boom')
  })
})
