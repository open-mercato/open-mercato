/** @jest-environment node */
/**
 * EP-42 — the settings key registry.
 *
 * The first block is the one that matters: with no contribution the eight built-in keys
 * produce the same defaults, the same validating schema and the same eight config rows
 * the module wrote before the registry existed.
 */
import { z } from 'zod'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import {
  BUILT_IN_TIME_TRACKING_SETTING_KEY_IDS,
  buildDefaultTimeTrackingSettings,
  buildTimeTrackingSettingsSchema,
  contributedTimeTrackingSettingKeys,
  isBuiltInTimeTrackingSettingKey,
  normalizeTimeTrackingSettingsRecord,
  registerTimeTrackingSettingKey,
  timeTrackingSettingKeyIds,
} from '../settingKeys'
import {
  DEFAULT_TIME_TRACKING_SETTINGS,
  STAFF_TIME_TRACKING_MODULE_ID,
  TIME_TRACKING_SETTING_KEYS,
  readTimeTrackingSettings,
  readTimeTrackingSettingValue,
  writeTimeTrackingSettings,
} from '../settings'

const TENANT = 'tenant-1'
const SCOPE = { tenantId: TENANT }

function createConfigService() {
  const store = new Map<string, unknown>()
  const writes: Array<{ name: string; value: unknown; scope: unknown }> = []
  const service = {
    getRecord: async (moduleId: string, name: string, scope?: { tenantId?: string | null }) => {
      if (moduleId !== STAFF_TIME_TRACKING_MODULE_ID) return null
      if (!store.has(name)) return null
      return {
        moduleId,
        name,
        value: store.get(name),
        tenantId: scope?.tenantId ?? null,
        organizationId: null,
        source: 'tenant',
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
      }
    },
    setValue: async (_moduleId: string, name: string, value: unknown, scope?: unknown) => {
      writes.push({ name, value, scope })
      store.set(name, value)
      return null
    },
  }
  return { store, writes, service: service as unknown as ModuleConfigService }
}

describe('built-in setting keys', () => {
  it('registers exactly the eight frozen keys', () => {
    expect([...BUILT_IN_TIME_TRACKING_SETTING_KEY_IDS].sort()).toEqual([...TIME_TRACKING_SETTING_KEYS].sort())
    expect(timeTrackingSettingKeyIds().sort()).toEqual([...TIME_TRACKING_SETTING_KEYS].sort())
    expect(contributedTimeTrackingSettingKeys()).toEqual([])
  })

  it('derives the shipped defaults from the registry', () => {
    expect(buildDefaultTimeTrackingSettings()).toEqual({
      rounding: { unitMinutes: 0, direction: 'up' },
      defaults: { billable: true, chainStartFromPreviousEnd: true },
      targets: { dailyHours: 8 },
      warnings: { overlap: true, runningTimer: true },
      access: { assignmentGraceDays: 14 },
    })
    expect(DEFAULT_TIME_TRACKING_SETTINGS).toEqual(buildDefaultTimeTrackingSettings())
  })

  it('builds the same validating schema the literal built', () => {
    const schema = buildTimeTrackingSettingsSchema()
    expect(schema.parse({})).toEqual(DEFAULT_TIME_TRACKING_SETTINGS)
    expect(() => schema.parse({ rounding: { unitMinutes: 7 } })).toThrow()
    expect(() => schema.parse({ access: { assignmentGraceDays: 1.5 } })).toThrow()
    expect(schema.parse({ targets: { dailyHours: null } }).targets).toEqual({ dailyHours: null })
  })
})

describe('contributed setting keys', () => {
  it('refuses to shadow a built-in key', () => {
    expect(() =>
      registerTimeTrackingSettingKey({
        group: 'rounding',
        key: 'unitMinutes',
        schema: z.number(),
        default: 0,
        labelKey: 'test.rounding.unit',
      }),
    ).toThrow(/built-in/)
  })

  it('refuses a default its own schema rejects', () => {
    expect(() =>
      registerTimeTrackingSettingKey({
        group: 'jira',
        key: 'projectKey',
        schema: z.string().min(1),
        default: '',
        labelKey: 'test.jira.projectKey',
      }),
    ).toThrow(/fails its own schema/)
  })

  it('round-trips a contributed key through the schema, the defaults, read and write', async () => {
    const dispose = registerTimeTrackingSettingKey({
      group: 'jira',
      key: 'projectKey',
      schema: z.string().min(1).max(20),
      default: 'OPS',
      labelKey: 'test.jira.projectKey',
    })
    try {
      expect(contributedTimeTrackingSettingKeys().map((entry) => entry.id)).toEqual(['jira.projectKey'])
      expect(isBuiltInTimeTrackingSettingKey('jira.projectKey')).toBe(false)

      const schema = buildTimeTrackingSettingsSchema()
      expect(schema.parse({}).jira).toEqual({ projectKey: 'OPS' })
      expect(() => schema.parse({ jira: { projectKey: '' } })).toThrow()

      expect(normalizeTimeTrackingSettingsRecord({ jira: { projectKey: 42 } }).jira).toEqual({ projectKey: 'OPS' })

      const { writes, service } = createConfigService()
      await writeTimeTrackingSettings(service, SCOPE, { jira: { projectKey: 'TIME' } })
      expect(writes).toHaveLength(9)
      expect(writes.find((write) => write.name === 'jira.projectKey')).toEqual({
        name: 'jira.projectKey',
        value: 'TIME',
        scope: { tenantId: TENANT },
      })

      const read = await readTimeTrackingSettings(service, SCOPE)
      expect(readTimeTrackingSettingValue(read, 'jira.projectKey')).toBe('TIME')
      expect(read.rounding).toEqual(DEFAULT_TIME_TRACKING_SETTINGS.rounding)
    } finally {
      dispose()
    }
  })

  it('leaves the built-in surface untouched once the contribution is disposed', () => {
    const dispose = registerTimeTrackingSettingKey({
      group: 'jira',
      key: 'projectKey',
      schema: z.string().min(1),
      default: 'OPS',
      labelKey: 'test.jira.projectKey',
    })
    dispose()
    expect(timeTrackingSettingKeyIds().sort()).toEqual([...TIME_TRACKING_SETTING_KEYS].sort())
    expect(buildDefaultTimeTrackingSettings()).toEqual(DEFAULT_TIME_TRACKING_SETTINGS)
  })

  /**
   * Every contributed key is written with `{ tenantId }` and nothing else, so it inherits
   * the tenant-global scope spec §10 fixes the built-ins at. There is no per-organization
   * override, and the stored `organization_id` stays null.
   */
  it('stores a contributed value tenant-scoped, never organization-scoped', async () => {
    const dispose = registerTimeTrackingSettingKey({
      group: 'jira',
      key: 'projectKey',
      schema: z.string().min(1),
      default: 'OPS',
      labelKey: 'test.jira.projectKey',
    })
    try {
      const { writes, service } = createConfigService()
      await writeTimeTrackingSettings(service, SCOPE, {})
      for (const write of writes) {
        expect(write.scope).toEqual({ tenantId: TENANT })
      }
    } finally {
      dispose()
    }
  })
})
