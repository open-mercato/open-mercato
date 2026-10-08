import { UniqueConstraintViolationException } from '@mikro-orm/core'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { InsightsProcessSettings } from '../../data/entities'

const findXraySettingsRecordMock = jest.fn()

jest.mock('../../lib/projection/settings', () => {
  const actual = jest.requireActual('../../lib/projection/settings')
  return { ...actual, findXraySettingsRecord: (...args: unknown[]) => findXraySettingsRecordMock(...args) }
})

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback?: string) => fallback ?? _key }),
}))

import { saveXraySettingsCommand } from '../xray-settings'

const TENANT_ID = '11111111-0000-4000-8000-000000000001'
const ORG_ID = '22222222-0000-4000-8000-000000000001'
const LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

function stored(updatedAt: Date, overrides: Partial<InsightsProcessSettings> = {}): InsightsProcessSettings {
  const record = new InsightsProcessSettings()
  Object.assign(record, {
    id: 'settings-1',
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    enabled: true,
    retentionDays: 365,
    kAnonymity: 10,
    debounceSeconds: 120,
    individualsEnabled: false,
    conformanceWorkflowId: null,
    activityStepMap: null,
    createdAt: updatedAt,
    updatedAt,
    deletedAt: null,
    ...overrides,
  })
  return record
}

type FakeEm = {
  fork: () => FakeEm
  nativeUpdate: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
}

function createEm(): FakeEm {
  const em: FakeEm = {
    fork: () => em,
    nativeUpdate: jest.fn(async () => 1),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => Object.assign(new InsightsProcessSettings(), { id: 'created-1', ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return em
}

function ctx(em: FakeEm, headers: Record<string, string> = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: (name: string) => {
        if (name === 'em') return em
        throw new Error(`[internal] unexpected ${name}`)
      },
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    request: new Request('http://localhost/api/insights/xray/settings', { method: 'PUT', headers }),
  } as unknown as CommandRuntimeContext
}

const input = { tenantId: TENANT_ID, organizationId: ORG_ID, retentionDays: 90, individualsEnabled: true }

describe('insights.xray.settings.save', () => {
  beforeEach(() => findXraySettingsRecordMock.mockReset())

  it('creates the settings row on first save with defaults for omitted fields', async () => {
    const em = createEm()
    findXraySettingsRecordMock.mockResolvedValueOnce(null)
    const result = await saveXraySettingsCommand.execute(input, ctx(em))
    expect(em.create).toHaveBeenCalledWith(InsightsProcessSettings, expect.objectContaining({
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
      enabled: true,
      retentionDays: 90,
      kAnonymity: 10,
      individualsEnabled: true,
    }))
    expect(result).toEqual(expect.objectContaining({ settingsId: 'created-1', retentionDays: 90, updatedAt: expect.any(String) }))
  })

  it('answers 409 when a concurrent first save created the row', async () => {
    const em = createEm()
    em.flush.mockRejectedValueOnce(new UniqueConstraintViolationException(new Error('duplicate key')))
    findXraySettingsRecordMock.mockResolvedValueOnce(null).mockResolvedValueOnce(stored(new Date('2026-10-08T10:00:00.000Z')))
    await expect(saveXraySettingsCommand.execute(input, ctx(em))).rejects.toMatchObject({ status: 409 })
  })

  it('updates with a compare-and-set on updated_at when the version header matches', async () => {
    const em = createEm()
    const version = new Date('2026-10-08T10:00:00.000Z')
    findXraySettingsRecordMock
      .mockResolvedValueOnce(stored(version))
      .mockResolvedValueOnce(stored(new Date('2026-10-08T10:00:01.000Z'), { retentionDays: 90, individualsEnabled: true }))
    const result = await saveXraySettingsCommand.execute(input, ctx(em, { [LOCK_HEADER]: version.toISOString() }))
    expect(em.nativeUpdate).toHaveBeenCalledWith(
      InsightsProcessSettings,
      { id: 'settings-1', tenantId: TENANT_ID, organizationId: ORG_ID, updatedAt: version },
      expect.objectContaining({ retentionDays: 90, individualsEnabled: true, deletedAt: null, updatedAt: expect.any(Date) }),
    )
    expect(result).toEqual(expect.objectContaining({ retentionDays: 90, individualsEnabled: true, updatedAt: '2026-10-08T10:00:01.000Z' }))
  })

  it('answers the structured 409 for a stale version header without writing', async () => {
    const em = createEm()
    findXraySettingsRecordMock.mockResolvedValueOnce(stored(new Date('2026-10-08T10:05:00.000Z')))
    const error = await Promise.resolve(saveXraySettingsCommand.execute(input, ctx(em, { [LOCK_HEADER]: '2026-10-08T10:00:00.000Z' }))).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(CrudHttpError)
    expect(error).toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-08T10:05:00.000Z' }) })
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('answers 409 when the row changed between the check and the write', async () => {
    const em = createEm()
    em.nativeUpdate.mockResolvedValueOnce(0)
    const version = new Date('2026-10-08T10:00:00.000Z')
    findXraySettingsRecordMock.mockResolvedValueOnce(stored(version)).mockResolvedValueOnce(stored(new Date('2026-10-08T10:00:02.000Z')))
    await expect(saveXraySettingsCommand.execute(input, ctx(em, { [LOCK_HEADER]: version.toISOString() })))
      .rejects.toMatchObject({ status: 409, body: expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: '2026-10-08T10:00:02.000Z' }) })
  })

  it('enforces the k-anonymity floor and rejects invalid input', async () => {
    const em = createEm()
    findXraySettingsRecordMock.mockResolvedValueOnce(null)
    await expect(saveXraySettingsCommand.execute({ ...input, kAnonymity: 4 }, ctx(em))).rejects.toThrow()
    await expect(saveXraySettingsCommand.execute({ ...input, retentionDays: 1 }, ctx(em))).rejects.toThrow()
  })

  it('refuses another tenant or organization than the caller scope', async () => {
    const em = createEm()
    findXraySettingsRecordMock.mockResolvedValue(null)
    await expect(saveXraySettingsCommand.execute({ ...input, tenantId: '11111111-0000-4000-8000-0000000000ff' }, ctx(em))).rejects.toBeInstanceOf(CrudHttpError)
  })
})
