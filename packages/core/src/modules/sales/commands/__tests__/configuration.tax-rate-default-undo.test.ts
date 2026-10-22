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
  findOneWithDecryption: jest.fn().mockResolvedValue(null),
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
  return {
    findOne: jest.fn().mockResolvedValue(existing),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    remove: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeUpdate: jest.fn().mockResolvedValue(1),
  }
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
    const record: Record<string, unknown> = { ...taxRateSnapshot({ isDefault: false }) }
    const em = buildEm(record)

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ isDefault: false }) },
      em,
    )

    expect(record.isDefault).toBe(true)
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
    const record: Record<string, unknown> = { ...taxRateSnapshot({ name: 'Renamed VAT', isDefault: false }) }
    const em = buildEm(record)

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) },
      em,
    )

    expect(record.name).toBe('Standard VAT')
    expect(record.isDefault).toBe(false)
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
    const record: Record<string, unknown> = { ...taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) }
    const em = buildEm(record)

    await runUndo(
      'sales.tax-rates.update',
      { before: taxRateSnapshot({ isDefault: true }), after: taxRateSnapshot({ name: 'Renamed VAT', isDefault: true }) },
      em,
    )

    expect(record.isDefault).toBe(true)
    expect(em.nativeUpdate).toHaveBeenCalledWith(...expectedDemotion)
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
