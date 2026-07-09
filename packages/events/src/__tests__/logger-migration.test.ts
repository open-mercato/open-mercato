import { createLogger } from '@open-mercato/shared/lib/logger'
import { createEventBus, registerGlobalEventTap } from '../bus'
import type { CreateBusOptions } from '../types'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const mocked = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(),
  }
  mocked.child.mockImplementation(() => mocked)
  return { createLogger: jest.fn(() => mocked) }
})

const busLoggerError = createLogger('events').error as jest.Mock

const busOptions: CreateBusOptions = {
  resolve: ((name: string) => name) as CreateBusOptions['resolve'],
}

describe('events bus logger migration (structured logging facade)', () => {
  beforeEach(() => {
    busLoggerError.mockClear()
  })

  it('still emits when a subscriber handler throws, now with structured fields', async () => {
    const bus = createEventBus(busOptions)
    bus.on('test.logger.event', () => {
      throw new Error('handler boom')
    })

    await bus.emit('test.logger.event', { id: 'record-1' })

    expect(busLoggerError).toHaveBeenCalledWith('Handler error', {
      event: 'test.logger.event',
      pattern: 'test.logger.event',
      err: expect.any(Error),
    })
  })

  it('still emits when a global tap throws, now with structured fields', async () => {
    const unregister = registerGlobalEventTap(() => {
      throw new Error('tap boom')
    })
    try {
      const bus = createEventBus(busOptions)
      await bus.emit('test.logger.tap', { id: 'record-2' })

      expect(busLoggerError).toHaveBeenCalledWith('Global tap error', {
        event: 'test.logger.tap',
        err: expect.any(Error),
      })
    } finally {
      unregister()
    }
  })
})
