/** @jest-environment node */

import { z } from 'zod'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    locale: 'en',
    dict: {},
    t: (key: string) => key,
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (
    emInstance: { findOne: (entity: unknown, filters: unknown) => Promise<unknown> },
    entity: unknown,
    filters: unknown,
  ) => emInstance.findOne(entity, filters),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const LOT_ID = '33333333-3333-4333-8333-333333333333'

type LotRecord = {
  id: string
  organizationId: string
  tenantId: string
  manufacturedAt: Date | null
  bestBeforeAt: Date | null
  expiresAt: Date | null
  status: string
  metadata: Record<string, unknown> | null
  deletedAt: Date | null
}

function createLotStore(dates: Pick<LotRecord, 'manufacturedAt' | 'bestBeforeAt' | 'expiresAt'>) {
  const record: LotRecord = {
    id: LOT_ID,
    organizationId: ORG,
    tenantId: TENANT,
    ...dates,
    status: 'available',
    metadata: null,
    deletedAt: null,
  }
  const em = {
    findOne: jest.fn(async (_entity: unknown, filters: { id?: string }) => (filters.id === record.id ? record : null)),
    flush: jest.fn(async () => undefined),
  }
  const ctx = {
    auth: { tenantId: TENANT, orgId: ORG },
    selectedOrganizationId: ORG,
    container: {
      resolve: (name: string) => {
        if (name === 'em') return { fork: () => em }
        throw new Error(`[internal] unexpected resolve: ${name}`)
      },
    },
  } as unknown as CommandRuntimeContext
  return { record, em, ctx }
}

const orderedDates = () => ({
  manufacturedAt: new Date('2020-01-01T00:00:00.000Z'),
  bestBeforeAt: new Date('2020-06-01T00:00:00.000Z'),
  expiresAt: new Date('2020-12-01T00:00:00.000Z'),
})

const outOfOrderDates = () => ({
  manufacturedAt: new Date('2020-06-01T00:00:00.000Z'),
  bestBeforeAt: null,
  expiresAt: new Date('2020-01-01T00:00:00.000Z'),
})

function updateHandler() {
  const handler = commandRegistry.get<Record<string, unknown>, { lotId: string }>('wms.lots.update')
  if (!handler) throw new Error('[internal] wms.lots.update is not registered')
  return handler
}

describe('wms.lots.update — date ordering against stored dates', () => {
  beforeAll(async () => {
    await import('../configuration')
  })

  it.each([
    ['expiresAt before the stored manufactured and best-before dates', { expiresAt: '2019-01-01T00:00:00.000Z' }, 'expiresAt'],
    ['manufacturedAt after the stored best-before date', { manufacturedAt: '2020-07-01T00:00:00.000Z' }, 'bestBeforeAt'],
    ['bestBeforeAt after the stored expiry date', { bestBeforeAt: '2021-01-01T00:00:00.000Z' }, 'expiresAt'],
  ])('rejects a patch of only %s and leaves the lot unchanged', async (_label, patch, issuePath) => {
    const { record, em, ctx } = createLotStore(orderedDates())
    const before = { ...record }

    const execution = updateHandler().execute({ id: LOT_ID, ...patch }, ctx)

    await expect(execution).rejects.toBeInstanceOf(z.ZodError)
    await expect(execution).rejects.toMatchObject({
      issues: expect.arrayContaining([expect.objectContaining({ path: [issuePath] })]),
    })
    expect(record).toEqual(before)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('accepts a single-date patch that keeps the stored dates in order', async () => {
    const { record, ctx } = createLotStore(orderedDates())

    await expect(
      updateHandler().execute({ id: LOT_ID, expiresAt: '2020-09-01T00:00:00.000Z' }, ctx),
    ).resolves.toEqual({ lotId: LOT_ID })
    expect(record.expiresAt?.toISOString()).toBe('2020-09-01T00:00:00.000Z')
  })

  it('accepts a single-date patch equal to a stored date', async () => {
    const { record, ctx } = createLotStore(orderedDates())

    await expect(
      updateHandler().execute({ id: LOT_ID, expiresAt: '2020-06-01T00:00:00.000Z' }, ctx),
    ).resolves.toEqual({ lotId: LOT_ID })
    expect(record.expiresAt?.toISOString()).toBe('2020-06-01T00:00:00.000Z')
  })

  it('still lets a status-only patch through on a lot whose stored dates are already out of order', async () => {
    const { record, ctx } = createLotStore(outOfOrderDates())

    await expect(updateHandler().execute({ id: LOT_ID, status: 'hold' }, ctx)).resolves.toEqual({ lotId: LOT_ID })
    expect(record.status).toBe('hold')
  })

  it('on a lot whose stored dates are already out of order, rejects a date patch that keeps them out of order', async () => {
    const { record, em, ctx } = createLotStore(outOfOrderDates())
    const before = { ...record }

    await expect(
      updateHandler().execute({ id: LOT_ID, bestBeforeAt: '2020-03-01T00:00:00.000Z' }, ctx),
    ).rejects.toBeInstanceOf(z.ZodError)
    expect(record).toEqual(before)
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('on a lot whose stored dates are already out of order, accepts a date patch that puts them back in order', async () => {
    const { record, ctx } = createLotStore(outOfOrderDates())

    await expect(
      updateHandler().execute({ id: LOT_ID, expiresAt: '2020-07-01T00:00:00.000Z' }, ctx),
    ).resolves.toEqual({ lotId: LOT_ID })
    expect(record.expiresAt?.toISOString()).toBe('2020-07-01T00:00:00.000Z')
  })
})
