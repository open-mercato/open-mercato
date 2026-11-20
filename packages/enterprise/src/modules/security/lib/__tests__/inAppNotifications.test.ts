import { EntityMetadata, MetadataStorage } from '@mikro-orm/core'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { inAppNotificationsAvailable } from '../inAppNotifications'

const warnMock = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: (...args: unknown[]) => warnMock(...args) }) }),
}))

function createContext(getMetadata: () => MetadataStorage) {
  return { resolve: <T = unknown>(): T => ({ getMetadata }) as T }
}

describe('in-app notification availability', () => {
  beforeEach(() => jest.clearAllMocks())

  it('warns and skips when Notification has no ORM metadata', () => {
    const metadata = new MetadataStorage()
    expect(metadata.has(Notification)).toBe(false)

    expect(inAppNotificationsAvailable(createContext(() => metadata))).toBe(false)
    expect(warnMock).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['the imported constructor', Notification],
    ['a separately bundled constructor', class Notification {}],
  ])('continues when metadata is registered with %s', (_description, registeredClass) => {
    const metadata = new MetadataStorage({
      Notification: new EntityMetadata({ class: registeredClass, className: 'Notification' }),
    })

    expect(metadata.find(Notification)).toBeDefined()
    expect(inAppNotificationsAvailable(createContext(() => metadata))).toBe(true)
    expect(warnMock).not.toHaveBeenCalled()
  })

  it('propagates unexpected metadata failures instead of treating them as an absent module', () => {
    const failure = new Error('Metadata service unavailable')

    expect(() => inAppNotificationsAvailable(createContext(() => { throw failure }))).toThrow(failure)
    expect(warnMock).not.toHaveBeenCalled()
  })

  it('propagates DI failures so delivery can retry', () => {
    const failure = new Error('Entity manager unavailable')

    expect(() => inAppNotificationsAvailable({ resolve: () => { throw failure } })).toThrow(failure)
    expect(warnMock).not.toHaveBeenCalled()
  })
})
