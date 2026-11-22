import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

const sideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
  buildCustomFieldResetMap: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: async () => [],
  findOneWithDecryption: (
    em: { findOne: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findOne(entity, where, options),
}))
jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: async ({ phases }: { phases: Array<() => Promise<void> | void> }) => {
    for (const phase of phases) await phase()
    sideEffects()
  },
}))
jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string) => key }),
}))

import '../evidence-submissions'

const RECORD_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const SUPPLIER_ID = '44444444-4444-4444-8444-444444444444'
const USER_ID = '55555555-5555-4555-8555-555555555555'

function harness(harvestFrom: string | null, harvestTo: string | null) {
  const record = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    supplierEntityId: SUPPLIER_ID,
    supplierSnapshot: null,
    commodity: 'coffee',
    productMappingId: null,
    statementId: null,
    originCountry: 'CI',
    geolocation: null,
    quantityKg: null,
    batchNumber: null,
    harvestFrom: harvestFrom ? new Date(harvestFrom) : null,
    harvestTo: harvestTo ? new Date(harvestTo) : null,
    producerName: null,
    attachmentIds: [],
    plotIds: [],
    status: 'draft',
    completenessScore: 0,
    missingFields: [],
    notes: 'Original notes',
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
  }
  const em = {
    fork: jest.fn(),
    transactional: jest.fn(async (work: (tx: unknown) => Promise<unknown>) => work(em)),
    findOne: jest.fn(async () => record),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: { resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`[internal] Unexpected dependency ${name}`)
    } },
    auth: { sub: USER_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  } as unknown as CommandRuntimeContext
  const command = commandRegistry.get('eudr.evidence_submissions.update') as CommandHandler
  return { record, ctx, command }
}

async function captureError(run: () => Promise<unknown>): Promise<unknown> {
  return run().then(() => null, (caught: unknown) => caught)
}

describe('EUDR evidence submission update harvest range', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('rejects a harvestTo-only patch that ends before the stored harvestFrom', async () => {
    const { record, ctx, command } = harness('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z')
    const error = await captureError(() => command.execute({ id: RECORD_ID, harvestTo: '2023-01-01' }, ctx))

    expect(isCrudHttpError(error)).toBe(true)
    if (isCrudHttpError(error)) {
      expect(error.status).toBe(400)
      expect(error.body).toEqual({ error: 'eudr.errors.harvestRange' })
    }
    expect(record.harvestFrom?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(record.harvestTo?.toISOString()).toBe('2024-06-01T00:00:00.000Z')
    expect(sideEffects).not.toHaveBeenCalled()
  })

  it('rejects a harvestFrom-only patch that starts after the stored harvestTo', async () => {
    const { record, ctx, command } = harness('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z')
    const error = await captureError(() => command.execute({ id: RECORD_ID, harvestFrom: '2024-09-01' }, ctx))

    expect(isCrudHttpError(error)).toBe(true)
    if (isCrudHttpError(error)) {
      expect(error.status).toBe(400)
      expect(error.body).toEqual({ error: 'eudr.errors.harvestRange' })
    }
    expect(record.harvestFrom?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(sideEffects).not.toHaveBeenCalled()
  })

  it('accepts a single-date patch that keeps the window ordered', async () => {
    const { record, ctx, command } = harness('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z')
    await command.execute({ id: RECORD_ID, harvestTo: '2024-03-01' }, ctx)

    expect(record.harvestTo?.toISOString()).toBe('2024-03-01T00:00:00.000Z')
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })

  it('accepts clearing one date', async () => {
    const { record, ctx, command } = harness('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z')
    await command.execute({ id: RECORD_ID, harvestFrom: null }, ctx)

    expect(record.harvestFrom).toBeNull()
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })

  it('accepts setting a new date while clearing the other one', async () => {
    const { record, ctx, command } = harness('2024-01-01T00:00:00Z', '2024-06-01T00:00:00Z')
    await command.execute({ id: RECORD_ID, harvestFrom: '2024-09-01', harvestTo: null }, ctx)

    expect(record.harvestFrom?.toISOString()).toBe('2024-09-01T00:00:00.000Z')
    expect(record.harvestTo).toBeNull()
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })

  it('repairs an already inverted record when both dates are sent in order', async () => {
    const { record, ctx, command } = harness('2024-06-01T00:00:00Z', '2024-01-01T00:00:00Z')
    await command.execute({ id: RECORD_ID, harvestFrom: '2024-01-01', harvestTo: '2024-06-01' }, ctx)

    expect(record.harvestFrom?.toISOString()).toBe('2024-01-01T00:00:00.000Z')
    expect(record.harvestTo?.toISOString()).toBe('2024-06-01T00:00:00.000Z')
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })

  it('still accepts an edit that leaves both dates untouched on an already inverted record', async () => {
    const { record, ctx, command } = harness('2024-06-01T00:00:00Z', '2024-01-01T00:00:00Z')
    await command.execute({ id: RECORD_ID, notes: 'Updated notes' }, ctx)

    expect(record.notes).toBe('Updated notes')
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })
})
