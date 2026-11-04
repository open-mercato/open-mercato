import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import '../dateLocale'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => `t:${key}` })),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '44444444-4444-4444-8444-444444444444'

const getRecordMock = jest.fn()
const setValueMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getRecord: (...args: unknown[]) => getRecordMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
      }
    }
    throw new Error(`Unexpected container resolve: ${name}`)
  }),
}

const ctx = {
  container,
  auth: { tenantId, sub: 'user-1', orgId: null },
  organizationScope: null,
  selectedOrganizationId: null,
  organizationIds: null,
} as unknown as CommandRuntimeContext

const empty = { locale: null, dateFormat: null, dateTimeFormat: null, timeFormat: null, timeZone: null, firstDayOfWeek: null }
const previous = { ...empty, timeZone: 'Europe/Warsaw', dateFormat: 'dd.MM.yyyy' }
const next = { ...empty, timeZone: 'Asia/Tokyo', firstDayOfWeek: 0 as const }

function handler() {
  const found = commandRegistry.get('configs.date_locale.update')
  if (!found) throw new Error('command not registered')
  return found
}

describe('configs.date_locale.update command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getRecordMock.mockResolvedValue({ value: previous, source: 'tenant', updatedAt: '2026-11-01T10:00:00.000Z' })
    setValueMock.mockResolvedValue(null)
  })

  it('writes the settings and logs the previous and new values for undo', async () => {
    const command = handler()
    const input = { tenantId, settings: next }
    const prepared = await command.prepare!(input, ctx)
    const result = await command.execute(input, ctx)
    const after = await command.captureAfter!(input, result, ctx)
    const log = await command.buildLog!({ input, result, ctx, snapshots: { before: prepared?.before, after } })

    expect(setValueMock).toHaveBeenCalledWith('configs', 'date_locale', next, { tenantId })
    expect(log).toEqual(
      expect.objectContaining({
        actionLabel: 't:configs.audit.dateLocale.update',
        resourceKind: 'configs.date_locale',
        resourceId: tenantId,
        tenantId,
        snapshotBefore: { tenantId, settings: previous },
        snapshotAfter: { tenantId, settings: next },
      }),
    )
  })

  it('restores the previous settings on undo', async () => {
    await handler().undo!({
      input: { tenantId, settings: next },
      ctx,
      logEntry: { commandPayload: { undo: { before: { tenantId, settings: previous }, after: { tenantId, settings: next } } } },
    } as never)
    expect(setValueMock).toHaveBeenCalledWith('configs', 'date_locale', previous, { tenantId })
  })

  it('refuses to write another tenant', async () => {
    await expect(handler().execute({ tenantId: otherTenantId, settings: next }, ctx)).rejects.toMatchObject({ status: 403 })
    expect(setValueMock).not.toHaveBeenCalled()
  })
})
