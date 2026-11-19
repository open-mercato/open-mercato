import { MetadataStorage } from '@mikro-orm/core'
import { Notification } from '@open-mercato/core/modules/notifications/data/entities'
import { inAppNotificationsAvailable } from '../inAppNotifications'

const warnMock = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: () => ({ child: () => ({ warn: (...args: unknown[]) => warnMock(...args) }) }),
}))

function createContext(getMetadata: () => Pick<MetadataStorage, 'has'>) {
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

  it('continues without a warning when Notification metadata exists', () => {
    const has = jest.fn(() => true)

    expect(inAppNotificationsAvailable(createContext(() => ({ has })))).toBe(true)
    expect(has).toHaveBeenCalledWith(Notification)
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
