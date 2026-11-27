jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(() => ({
    enqueue: jest.fn(),
    clear: jest.fn(),
    close: jest.fn(),
  })),
}))

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

  it('hands inline subscribers the bus container as ctx.container', async () => {
    const container = { resolve: () => undefined, register: jest.fn() }
    const bus = createEventBus({ resolve: container.resolve, container })
    let seen: unknown = null
    bus.on('demo.container', async (_payload: unknown, ctx: { container?: unknown }) => {
      seen = ctx.container
    })

    await bus.emit('demo.container', {})

    expect(seen).toBe(container)
  })

  it('rejects the emit when rethrowHandlerErrors is enabled', async () => {
    const bus = createEventBus({ resolve: () => undefined })
    bus.on('demo.failed', async () => {
      throw new Error('boom')
    })

    await expect(bus.emit('demo.failed', {}, { rethrowHandlerErrors: true })).rejects.toThrow('boom')
  })
})
