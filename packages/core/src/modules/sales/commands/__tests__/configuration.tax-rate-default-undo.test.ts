/** @jest-environment node */

import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { SalesTaxRate } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((em: { findOne: (entity: unknown, where: unknown) => unknown }, entity: unknown, where: unknown) =>
    em.findOne(entity, where),
  ),
  findWithDecryption: jest.fn().mockResolvedValue([]),
}))

jest.mock('@open-mercato/shared/lib/crud/custom-fields', () => ({
  loadCustomFieldValues: jest.fn().mockResolvedValue({}),
}))

jest.mock('@open-mercato/core/modules/entities/lib/helpers', () => ({
  setRecordCustomFields: jest.fn().mockResolvedValue(undefined),
}))

const TENANT_ID = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'
const ORG_ID = 'bbbbbbbb-bbbb-4bbb-abbb-bbbbbbbbbbbb'
const RATE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function taxRateSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: RATE_ID,
    organizationId: ORG_ID,
    tenantId: TENANT_ID,
    name: 'Standard VAT',
    code: 'vat-std',
    rate: '23.0000',
    countryCode: 'PL',
    regionCode: null,
    postalCode: null,
    city: null,
    customerGroupId: null,
    productCategoryId: null,
    channelId: null,
    priority: 0,
    isCompound: false,
    isDefault: true,
    metadata: null,
    startsAt: null,
    endsAt: null,
    custom: null,
    ...overrides,
  }
}

function buildEm(existing: Record<string, unknown> | null) {
  const committed: { record: Record<string, unknown> | null; othersDemoted: boolean } = {
    record: existing ? { ...existing } : null,
    othersDemoted: false,
  }
  let staged: typeof committed | null = null
  let managed: Record<string, unknown> | null = null
  const em = {
    committed,
    findOne: jest.fn(async () => {
      managed = committed.record ? { ...committed.record } : null
      return managed
    }),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn((record: Record<string, unknown>) => {
      managed = record
    }),
    remove: jest.fn(),
    flush: jest.fn(async () => {
      expect(staged).not.toBeNull()
      staged!.record = managed ? { ...managed } : null
    }),
    nativeUpdate: jest.fn(async () => {
      expect(staged).not.toBeNull()
      staged!.othersDemoted = true
      return 1
    }),
    transactional: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
      staged = { ...committed }
      try {
        const result = await callback(em)
        Object.assign(committed, staged)
        return result
      } finally {
        staged = null
      }
    }),
  }
  return em
}

function buildCtx(em: ReturnType<typeof buildEm>) {
  return {
    container: {
      resolve: jest.fn((name: string) => {
        if (name === 'em') return { fork: () => em }
        if (name === 'dataEngine') return { setCustomFields: jest.fn().mockResolvedValue(undefined) }
        return {}
      }),
    },
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORG_ID },
    selectedOrganizationId: ORG_ID,
    organizationIds: [ORG_ID],
    organizationScope: null,
  }
}

const expectedDemotion = [
  SalesTaxRate,
  { organizationId: ORG_ID, tenantId: TENANT_ID, deletedAt: null, id: { $ne: RATE_ID } },
  { isDefault: false },
]

async function runUndo(commandId: string, payload: Record<string, unknown>, em: ReturnType<typeof buildEm>) {
  const handler = commandRegistry.get(commandId)
  expect(handler?.undo).toBeInstanceOf(Function)
  await handler!.undo!({ logEntry: { payload: { undo: payload } }, ctx: buildCtx(em) } as never)
}

describe('sales tax-rate undo keeps a single default tax rate per scope', () => {
  beforeAll(async () => {
    await import('../configuration')
  })

  it('demotes other defaults when update undo restores isDefault=true', async () => {
    const em = buildEm({ ...taxRateSnapshot({ isDefault: false }) })

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ isDefault: false }) },
      em,
    )

    expect(em.committed.record?.isDefault).toBe(true)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledWith(...expectedDemotion)
    expect(em.nativeUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(em.flush.mock.invocationCallOrder[0])
  })

  it('demotes other defaults when delete undo recreates a default tax rate', async () => {
    const em = buildEm(null)

    await runUndo('sales.tax-rates.delete', { before: taxRateSnapshot({ isDefault: true }) }, em)

    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledWith(...expectedDemotion)
    expect(em.nativeUpdate.mock.invocationCallOrder[0]).toBeGreaterThan(em.flush.mock.invocationCallOrder[0])
  })

  it('keeps the current isDefault when the undone update did not change it', async () => {
    const em = buildEm({ ...taxRateSnapshot({ name: 'Renamed VAT', isDefault: false }) })

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) },
      em,
    )

    expect(em.committed.record?.name).toBe('Standard VAT')
    expect(em.committed.record?.isDefault).toBe(false)
    expect(em.nativeUpdate).not.toHaveBeenCalled()
  })

  it('demotes other defaults when update undo recreates a missing default tax rate', async () => {
    const em = buildEm(null)

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) },
      em,
    )

    expect(em.persist).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledTimes(1)
    expect(em.nativeUpdate).toHaveBeenCalledWith(...expectedDemotion)
  })

  it('still demotes other defaults when the kept isDefault is true', async () => {
    const em = buildEm({ ...taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) })

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) },
      em,
    )

    expect(em.committed.record?.isDefault).toBe(true)
    expect(em.nativeUpdate).toHaveBeenCalledWith(...expectedDemotion)
  })

  it('rolls back the restored default when demoting other defaults fails, and a retry commits both writes', async () => {
    const em = buildEm({ ...taxRateSnapshot({ isDefault: false }) })
    const undoPayload = { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ isDefault: false }) }
    em.nativeUpdate.mockRejectedValueOnce(new Error('[internal] demotion failed'))

    await expect(runUndo('sales.tax-rates.update', undoPayload, em)).rejects.toThrow('[internal] demotion failed')

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.committed.record?.isDefault).toBe(false)
    expect(em.committed.othersDemoted).toBe(false)

    await runUndo('sales.tax-rates.update', undoPayload, em)

    expect(em.transactional).toHaveBeenCalledTimes(2)
    expect(em.committed.record?.isDefault).toBe(true)
    expect(em.committed.othersDemoted).toBe(true)
  })

  it('rolls back the recreated default when demoting other defaults fails on delete undo, and a retry commits both writes', async () => {
    const em = buildEm(null)
    const undoPayload = { before: taxRateSnapshot({ isDefault: true }) }
    em.nativeUpdate.mockRejectedValueOnce(new Error('[internal] demotion failed'))

    await expect(runUndo('sales.tax-rates.delete', undoPayload, em)).rejects.toThrow('[internal] demotion failed')

    expect(em.flush).toHaveBeenCalledTimes(1)
    expect(em.committed.record).toBeNull()
    expect(em.committed.othersDemoted).toBe(false)

    await runUndo('sales.tax-rates.delete', undoPayload, em)

    expect(em.committed.record).toMatchObject({ id: RATE_ID, isDefault: true })
    expect(em.committed.othersDemoted).toBe(true)
  })

  it('leaves other tax rates untouched when the restored snapshot is not the default', async () => {
    const updateEm = buildEm({ ...taxRateSnapshot({ isDefault: true }) })
    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: false }), after: taxRateSnapshot({ isDefault: true }) },
      updateEm,
    )
    expect(updateEm.nativeUpdate).not.toHaveBeenCalled()

    const deleteEm = buildEm(null)
    await runUndo('sales.tax-rates.delete', { before: taxRateSnapshot({ isDefault: false }) }, deleteEm)
    expect(deleteEm.nativeUpdate).not.toHaveBeenCalled()
  })
})
