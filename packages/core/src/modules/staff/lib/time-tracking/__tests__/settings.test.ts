import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { staffTimeTrackingSettingsSchema } from '../../../data/validators'
import {
  DEFAULT_ASSIGNMENT_GRACE_DAYS,
  DEFAULT_TIME_TRACKING_SETTINGS,
  STAFF_TIME_TRACKING_MODULE_ID,
  TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY,
  TIME_TRACKING_SETTING_KEYS,
  normalizeTimeTrackingSettings,
  readTimeTrackingSettings,
  writeTimeTrackingSettings,
} from '../settings'

const TENANT = 'tenant-1'
const SCOPE = { tenantId: TENANT }

function createConfigService(initial: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(initial))
  const service = {
    getRecord: async (moduleId: string, name: string) => {
      if (moduleId !== STAFF_TIME_TRACKING_MODULE_ID) return null
      if (!store.has(name)) return null
      return {
        moduleId,
        name,
        value: store.get(name),
        tenantId: TENANT,
        organizationId: null,
        source: 'tenant',
        createdAt: '2026-08-12T00:00:00.000Z',
        updatedAt: '2026-08-12T00:00:00.000Z',
      }
    },
    setValue: async (moduleId: string, name: string, value: unknown) => {
      store.set(name, value)
      return null
    },
  }
  return { store, service: service as unknown as ModuleConfigService }
}

describe('time tracking access settings', () => {
  it('registers the assignment grace key alongside the other setting keys', () => {
    expect(TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY).toBe('access.assignmentGraceDays')
    expect(TIME_TRACKING_SETTING_KEYS).toContain(TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY)
  })

  it('defaults the assignment grace to 14 days', () => {
    expect(DEFAULT_ASSIGNMENT_GRACE_DAYS).toBe(14)
    expect(DEFAULT_TIME_TRACKING_SETTINGS.access).toEqual({ assignmentGraceDays: 14 })
    expect(normalizeTimeTrackingSettings({}).access.assignmentGraceDays).toBe(14)
  })

  it('keeps an explicit zero instead of swallowing it as falsy', () => {
    expect(normalizeTimeTrackingSettings({ access: { assignmentGraceDays: 0 } }).access).toEqual({
      assignmentGraceDays: 0,
    })
  })

  it('falls back to the default for an invalid grace value', () => {
    const cases = [-1, 1.5, 366, Number.NaN, 'seven' as unknown as number, null]
    for (const value of cases) {
      expect(
        normalizeTimeTrackingSettings({ access: { assignmentGraceDays: value as number } }).access
          .assignmentGraceDays,
      ).toBe(14)
    }
  })

  it('reads the default when the tenant never stored the key', async () => {
    const { service } = createConfigService()
    const settings = await readTimeTrackingSettings(service, SCOPE)
    expect(settings.access.assignmentGraceDays).toBe(14)
  })

  it('round-trips an explicit zero through write and read', async () => {
    const { store, service } = createConfigService()
    const written = await writeTimeTrackingSettings(service, SCOPE, {
      access: { assignmentGraceDays: 0 },
    })
    expect(written.access.assignmentGraceDays).toBe(0)
    expect(store.get(TIME_TRACKING_ACCESS_ASSIGNMENT_GRACE_DAYS_KEY)).toBe(0)

    const read = await readTimeTrackingSettings(service, SCOPE)
    expect(read.access.assignmentGraceDays).toBe(0)
  })

  it('round-trips a custom grace period and leaves the other groups intact', async () => {
    const { service } = createConfigService()
    await writeTimeTrackingSettings(service, SCOPE, { access: { assignmentGraceDays: 30 } })
    const read = await readTimeTrackingSettings(service, SCOPE)
    expect(read).toEqual({
      ...DEFAULT_TIME_TRACKING_SETTINGS,
      access: { assignmentGraceDays: 30 },
    })
  })
})

describe('staffTimeTrackingSettingsSchema access group', () => {
  it('defaults the whole group when it is absent', () => {
    expect(staffTimeTrackingSettingsSchema.parse({}).access).toEqual({ assignmentGraceDays: 14 })
  })

  it('accepts zero and the maximum grace period', () => {
    expect(
      staffTimeTrackingSettingsSchema.parse({ access: { assignmentGraceDays: 0 } }).access
        .assignmentGraceDays,
    ).toBe(0)
    expect(
      staffTimeTrackingSettingsSchema.parse({ access: { assignmentGraceDays: 365 } }).access
        .assignmentGraceDays,
    ).toBe(365)
  })

  it('rejects a negative, fractional or oversized grace period', () => {
    expect(() => staffTimeTrackingSettingsSchema.parse({ access: { assignmentGraceDays: -1 } })).toThrow()
    expect(() => staffTimeTrackingSettingsSchema.parse({ access: { assignmentGraceDays: 1.5 } })).toThrow()
    expect(() => staffTimeTrackingSettingsSchema.parse({ access: { assignmentGraceDays: 366 } })).toThrow()
  })
})
