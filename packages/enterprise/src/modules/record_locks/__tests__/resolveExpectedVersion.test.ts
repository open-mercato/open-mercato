import { createRecordLockService } from '../lib/recordLockService'
import { DEFAULT_RECORD_LOCK_SETTINGS } from '../lib/config'

function makeService(settings: Record<string, unknown>) {
  const moduleConfigService = {
    getValue: jest.fn().mockResolvedValue(settings),
    setValue: jest.fn().mockResolvedValue(undefined),
  }
  const em = {} as never
  return createRecordLockService({ em, moduleConfigService: moduleConfigService as never })
}

describe('RecordLockService.resolveExpectedVersion (command-guard resolveExpected seam)', () => {
  test('derives the expected version from the header (server compares it against DB updated_at) — no client lock token required', async () => {
    const service = makeService({ ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['*'] })
    const expected = await service.resolveExpectedVersion({
      resourceKind: 'sales.order',
      expectedFromHeader: '2026-06-01T00:00:00.000Z',
    })
    expect(expected).toBe('2026-06-01T00:00:00.000Z')
  })

  test('returns header token (floor behavior) even when the resource is NOT enabled in settings', async () => {
    const service = makeService({ ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['customers.person'] })
    const expected = await service.resolveExpectedVersion({
      resourceKind: 'sales.order',
      expectedFromHeader: '2026-06-01T00:00:00.000Z',
    })
    expect(expected).toBe('2026-06-01T00:00:00.000Z')
  })

  test('passes through a null header (no version sent → floor is a no-op)', async () => {
    const service = makeService({ ...DEFAULT_RECORD_LOCK_SETTINGS, enabledResources: ['*'] })
    const expected = await service.resolveExpectedVersion({
      resourceKind: 'sales.order',
      expectedFromHeader: null,
    })
    expect(expected).toBeNull()
  })
})
