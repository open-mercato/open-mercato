import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'

let customFields: Record<string, unknown> = {}
const sideEffects = jest.fn()

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  loadCustomFieldSnapshot: jest.fn(async () => ({ ...customFields })),
  buildCustomFieldResetMap: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
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
  resolveTranslations: async () => ({ translate: (key: string) => `translated:${key}` }),
}))

import '../plots'
import '../statements'
import '../risk-assessments'
import '../evidence-submissions'
import '../product-mappings'
import '../mitigation-actions'

const RECORD_ID = '11111111-1111-4111-8111-111111111111'
const TENANT_ID = '22222222-2222-4222-8222-222222222222'
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333'
const commandNames = ['plots', 'statements', 'risk_assessments', 'evidence_submissions', 'product_mappings', 'mitigation_actions']

function harness(resource: string) {
  const record = {
    id: RECORD_ID,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    name: 'Original plot',
    title: 'Original record',
    notes: 'Original notes',
    supplierEntityId: RECORD_ID,
    productId: RECORD_ID,
    statementId: RECORD_ID,
    riskAssessmentId: RECORD_ID,
    commodity: 'coffee',
    originCountry: 'CI',
    plotType: 'point',
    geometry: { type: 'Point', coordinates: [-5.3, 6.8] },
    areaHa: '1',
    validationWarnings: [],
    status: 'draft',
    isActive: true,
    isInScope: true,
    countryRisks: [],
    criteria: {},
    conclusion: 'negligible',
    assessedAt: new Date('2026-11-01T00:00:00Z'),
    createdAt: new Date('2026-11-01T00:00:00Z'),
    updatedAt: new Date('2026-11-01T00:00:00Z'),
    deletedAt: null,
  }
  const em = {
    fork: jest.fn(),
    findOne: jest.fn(async (_entity?: unknown, _where?: unknown, _options?: { refresh?: boolean }) => record),
  }
  em.fork.mockReturnValue(em)
  const ctx = {
    container: { resolve: (name: string) => {
      if (name === 'em') return em
      throw new Error(`[internal] Unexpected dependency ${name}`)
    } },
    auth: { sub: RECORD_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  } as unknown as CommandRuntimeContext
  const command = commandRegistry.get(`eudr.${resource}.update`) as CommandHandler
  const input = resource === 'plots' ? { id: RECORD_ID, name: 'My edit' } : { id: RECORD_ID, notes: 'My edit' }
  return { record, em, ctx, command, input }
}

describe.each(commandNames)('EUDR %s update redo', (resource) => {
  beforeEach(() => {
    jest.clearAllMocks()
    customFields = {}
  })

  it.each(['scalar', 'custom', 'lock-time'])('refuses a later %s edit before mutation or side effects', async (change) => {
    const { record, em, ctx, command, input } = harness(resource)
    const snapshots = await command.prepare!(input, ctx)
    const before = JSON.parse(JSON.stringify(snapshots!.before)) as Record<string, unknown>
    if (change === 'scalar') {
      record.name = 'Colleague plot'
      record.notes = 'Colleague notes'
    } else if (change === 'custom') {
      customFields = { reviewed: true }
    } else {
      em.findOne.mockImplementation(async (_entity?: unknown, _where?: unknown, options?: { refresh?: boolean }) => {
        if (options?.refresh) {
          record.name = 'Colleague plot'
          record.notes = 'Colleague notes'
        }
        return record
      })
    }
    const error = await Promise.resolve().then(() => command.redo!({
      input, ctx, logEntry: { commandPayload: { undo: { before } } },
    })).catch((caught: unknown) => caught)

    expect(isCrudHttpError(error)).toBe(true)
    if (isCrudHttpError(error)) {
      expect(error.status).toBe(409)
      expect(error.body).toEqual({ error: 'translated:eudr.errors.redoConflict', code: 'eudr.errors.redoConflict' })
    }
    expect(record.name).not.toBe('My edit')
    expect(record.notes).not.toBe('My edit')
    expect(sideEffects).not.toHaveBeenCalled()
    expect(em.findOne).toHaveBeenCalledWith(expect.anything(), {
      id: RECORD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID, deletedAt: null,
    }, { refresh: true, lockMode: LockMode.PESSIMISTIC_WRITE })
  })

  it('fails closed when the persisted before snapshot is missing', async () => {
    const { command, input, ctx } = harness(resource)
    await expect(command.redo!({ input, ctx, logEntry: {} })).rejects.toMatchObject({ status: 409 })
    expect(sideEffects).not.toHaveBeenCalled()
  })
})

describe('plot redo without later edits', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    customFields = {}
  })

  it('replays the forward edit when only the undo timestamp changed', async () => {
    const { command, input, ctx, record } = harness('plots')
    const snapshots = await command.prepare!(input, ctx)
    const before = JSON.parse(JSON.stringify(snapshots!.before)) as Record<string, unknown>
    record.updatedAt = new Date('2026-11-02T00:00:00Z')

    await expect(command.redo!({ input, ctx, logEntry: { snapshotBefore: before } })).resolves.toMatchObject({ entityId: RECORD_ID })

    expect(record.name).toBe('My edit')
    expect(sideEffects).toHaveBeenCalledTimes(1)
  })

  it('keeps normal updates independent of replay snapshots', async () => {
    const { command, input, ctx, record, em } = harness('plots')
    await command.execute(input, ctx)
    expect(record.name).toBe('My edit')
    expect(em.findOne).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ lockMode: LockMode.PESSIMISTIC_WRITE }))
  })
})
