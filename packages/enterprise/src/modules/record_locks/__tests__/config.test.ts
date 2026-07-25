import {
  DEFAULT_RECORD_LOCK_SETTINGS,
  isRecordLockingEnabledForResource,
  normalizeRecordLockSettings,
} from '../lib/config'

describe('record_locks config defaults', () => {
  test('enables optimistic locking by default', () => {
    expect(DEFAULT_RECORD_LOCK_SETTINGS.enabled).toBe(true)
    expect(DEFAULT_RECORD_LOCK_SETTINGS.strategy).toBe('optimistic')
    expect(DEFAULT_RECORD_LOCK_SETTINGS.maxActiveLocksPerUser).toBe(50)
  })

  test('applies locking to all resources when enabledResources is empty', () => {
    const settings = {
      ...DEFAULT_RECORD_LOCK_SETTINGS,
      enabledResources: [],
    }

    expect(isRecordLockingEnabledForResource(settings, 'customers.company')).toBe(true)
    expect(isRecordLockingEnabledForResource(settings, 'sales.quote')).toBe(true)
  })

  test('normalizes missing per-user lock cap to the safe default', () => {
    const settings = normalizeRecordLockSettings({
      enabled: true,
      strategy: 'pessimistic',
      timeoutSeconds: 300,
      heartbeatSeconds: 30,
      enabledResources: ['sales.quote'],
      allowForceUnlock: true,
      allowIncomingOverride: true,
      notifyOnConflict: true,
    })

    expect(settings.maxActiveLocksPerUser).toBe(50)
  })
})
