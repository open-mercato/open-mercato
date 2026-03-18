import {
  DEFAULT_RECORD_LOCK_SETTINGS,
  isRecordLockingEnabledForResource,
} from '../lib/config'

describe('record_locks config defaults', () => {
  test('enables optimistic locking by default', () => {
    expect(DEFAULT_RECORD_LOCK_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_RECORD_LOCK_SETTINGS.strategy).toBe('optimistic')
  })

  test('applies locking to all resources when enabledResources is empty', () => {
    const settings = {
      ...DEFAULT_RECORD_LOCK_SETTINGS,
      enabledResources: [],
    }

    expect(isRecordLockingEnabledForResource(settings, 'customers.company')).toBe(true)
    expect(isRecordLockingEnabledForResource(settings, 'sales.quote')).toBe(true)
  })
})
