import { commandRegistry, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import '../dateLocale'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({ translate: (key: string) => `t:${key}` })),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const otherTenantId = '44444444-4444-4444-8444-444444444444'

const getRecordMock = jest.fn()
const setValueMock = jest.fn()
const invalidateMock = jest.fn()
const userHasAllFeaturesMock = jest.fn()

const container = {
  resolve: jest.fn((name: string) => {
    if (name === 'moduleConfigService') {
      return {
        getRecord: (...args: unknown[]) => getRecordMock(...args),
        setValue: (...args: unknown[]) => setValueMock(...args),
        invalidate: (...args: unknown[]) => invalidateMock(...args),
      }
    }
    if (name === 'rbacService') {
      return { userHasAllFeaturesWithEntityManager: (...args: unknown[]) => userHasAllFeaturesMock(...args) }
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

  describe('replay', () => {
    const findOneMock = jest.fn()
    const flushMock = jest.fn()
    const persistMock = jest.fn()
    const em = {
      findOne: (...args: unknown[]) => findOneMock(...args),
      flush: (...args: unknown[]) => flushMock(...args),
      persist: (...args: unknown[]) => persistMock(...args),
      create: (_entity: unknown, data: Record<string, unknown>) => ({ ...data }),
    }
    const replayCtx = { ...ctx, transactionalEm: em } as unknown as CommandRuntimeContext
    const logEntry = {
      tenantId,
      commandPayload: { undo: { before: { tenantId, settings: previous }, after: { tenantId, settings: next } } },
    }
    const authorize = (operation: 'undo' | 'redo', context: CommandRuntimeContext = replayCtx) =>
      handler().authorizeReplay!({ operation, input: { tenantId, settings: next }, ctx: context, logEntry } as never)

    beforeEach(() => {
      userHasAllFeaturesMock.mockResolvedValue(true)
      findOneMock.mockResolvedValue({ valueJson: next })
      flushMock.mockResolvedValue(undefined)
      invalidateMock.mockResolvedValue(undefined)
    })

    it('runs undo and redo inside the replay transaction', () => {
      expect(handler().atomicReplay).toBe(true)
    })

    it('allows undo while the actor can still manage the settings and nothing changed since', async () => {
      await expect(authorize('undo')).resolves.toBeUndefined()
      expect(userHasAllFeaturesMock).toHaveBeenCalledWith(em, 'user-1', ['configs.date_locale.manage'], {
        tenantId,
        organizationId: null,
      })
      expect(findOneMock).toHaveBeenCalledWith(
        expect.anything(),
        { moduleId: 'configs', name: 'date_locale', tenantId },
        expect.objectContaining({ lockMode: expect.anything() }),
      )
    })

    it('refuses undo after the actor lost the manage feature', async () => {
      userHasAllFeaturesMock.mockResolvedValue(false)
      await expect(authorize('undo')).rejects.toMatchObject({ status: 403 })
      expect(findOneMock).not.toHaveBeenCalled()
    })

    it('refuses undo once another administrator changed the settings', async () => {
      findOneMock.mockResolvedValue({ valueJson: { ...next, timeZone: 'America/New_York' } })
      await expect(authorize('undo')).rejects.toMatchObject({ status: 409 })
    })

    it('refuses undo when the settings row is gone', async () => {
      findOneMock.mockResolvedValue(null)
      await expect(authorize('undo')).rejects.toMatchObject({ status: 409 })
    })

    it('checks redo against the restored settings', async () => {
      findOneMock.mockResolvedValue({ valueJson: previous })
      await expect(authorize('redo')).resolves.toBeUndefined()
      findOneMock.mockResolvedValue({ valueJson: next })
      await expect(authorize('redo')).rejects.toMatchObject({ status: 409 })
    })

    it('refuses replay for another tenant', async () => {
      const otherCtx = { ...replayCtx, auth: { tenantId: otherTenantId, sub: 'user-1', orgId: null } } as unknown as CommandRuntimeContext
      await expect(authorize('undo', otherCtx)).rejects.toMatchObject({ status: 403 })
      expect(userHasAllFeaturesMock).not.toHaveBeenCalled()
    })

    it('skips the feature check for a system actor but still rejects stale state', async () => {
      const systemCtx = { ...replayCtx, systemActor: true } as unknown as CommandRuntimeContext
      await expect(authorize('undo', systemCtx)).resolves.toBeUndefined()
      expect(userHasAllFeaturesMock).not.toHaveBeenCalled()
      findOneMock.mockResolvedValue({ valueJson: previous })
      await expect(authorize('undo', systemCtx)).rejects.toMatchObject({ status: 409 })
    })

    it('writes the restored settings through the transaction and drops the cached value', async () => {
      const row = { valueJson: next, updatedAt: new Date('2026-11-01T10:00:00.000Z') }
      findOneMock.mockResolvedValue(row)
      await handler().undo!({ input: { tenantId, settings: next }, ctx: replayCtx, logEntry } as never)
      expect(row.valueJson).toEqual(previous)
      expect(flushMock).toHaveBeenCalled()
      expect(setValueMock).not.toHaveBeenCalled()
      expect(invalidateMock).toHaveBeenCalledWith('configs', 'date_locale', { tenantId })
    })
  })
})
