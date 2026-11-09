import '@open-mercato/core/modules/eudr/commands/plots'
import '@open-mercato/core/modules/eudr/commands/risk-assessments'
import '@open-mercato/core/modules/eudr/commands/product-mappings'
import '@open-mercato/core/modules/eudr/commands/mitigation-actions'
import '@open-mercato/core/modules/eudr/commands/evidence-submissions'
import '@open-mercato/core/modules/eudr/commands/statements'
import { LockMode } from '@mikro-orm/core'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { loadCustomFieldSnapshot } from '@open-mercato/shared/lib/commands/customFieldSnapshots'
import { computeSubmissionCompleteness } from '../../lib/completeness'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => `translated:${key}:${fallback ?? ''}`,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(),
}))

const findOneWithDecryptionMock = findOneWithDecryption as jest.Mock
const loadCustomFieldSnapshotMock = loadCustomFieldSnapshot as jest.Mock

const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const RECORD_ID = 'record-1'
const CONFLICT_CODE = 'eudr.errors.undoConflict'
const CONFLICT_FALLBACK = 'This record changed after the action you are undoing. Undo was refused.'

type Snapshot = Record<string, unknown> & {
  id: string
  tenantId: string
  organizationId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  custom?: Record<string, unknown> | null
}

type EntityFixture = {
  name: string
  createCommand: string
  updateCommand: string
  finder: 'decryption' | 'entityManager'
  dateKeys: string[]
  field: string
  beforeValue: unknown
  afterValue: unknown
  concurrentValue: unknown
  base: Omit<Snapshot, 'id' | 'tenantId' | 'organizationId' | 'createdAt' | 'updatedAt' | 'deletedAt'>
}

const fixtures: EntityFixture[] = [
  {
    name: 'plot',
    createCommand: 'eudr.plots.create',
    updateCommand: 'eudr.plots.update',
    finder: 'decryption',
    dateKeys: [],
    field: 'name',
    beforeValue: 'North field',
    afterValue: 'North field (surveyed)',
    concurrentValue: 'North field (re-surveyed by another user)',
    base: {
      supplierEntityId: 'supplier-1',
      supplierSnapshot: { displayName: 'Supplier' },
      externalId: null,
      description: null,
      originCountry: 'BR',
      plotType: 'polygon',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
      areaHa: '12.5',
      validationWarnings: ['selfIntersection'],
      producerName: null,
      isActive: true,
    },
  },
  {
    name: 'risk assessment',
    createCommand: 'eudr.risk_assessments.create',
    updateCommand: 'eudr.risk_assessments.update',
    finder: 'decryption',
    dateKeys: ['assessedAt', 'reviewDueAt'],
    field: 'conclusion',
    beforeValue: 'non_negligible',
    afterValue: 'negligible',
    concurrentValue: 'non_negligible_mitigated',
    base: {
      statementId: 'statement-1',
      countryRisks: [{ country: 'BR', tier: 'standard' }],
      overallTier: 'standard',
      criteria: { deforestation: { answer: 'no', note: 'checked' } },
      isSimplified: false,
      assessedAt: '2026-09-01T00:00:00.000Z',
      assessedByName: 'Analyst',
      reviewDueAt: '2027-09-01T00:00:00.000Z',
      notes: null,
    },
  },
  {
    name: 'product mapping',
    createCommand: 'eudr.product_mappings.create',
    updateCommand: 'eudr.product_mappings.update',
    finder: 'entityManager',
    dateKeys: [],
    field: 'hsCode',
    beforeValue: '0901',
    afterValue: '090111',
    concurrentValue: '090121',
    base: {
      productId: 'product-1',
      productSnapshot: { name: 'Coffee', sku: 'COF-1' },
      commodity: 'coffee',
      isInScope: true,
      notes: null,
      speciesScientificName: null,
      speciesCommonName: null,
    },
  },
  {
    name: 'mitigation action',
    createCommand: 'eudr.mitigation_actions.create',
    updateCommand: 'eudr.mitigation_actions.update',
    finder: 'decryption',
    dateKeys: ['dueDate', 'completedAt'],
    field: 'status',
    beforeValue: 'open',
    afterValue: 'in_progress',
    concurrentValue: 'cancelled',
    base: {
      riskAssessmentId: 'assessment-1',
      actionType: 'audit',
      title: 'Audit supplier',
      description: null,
      dueDate: '2026-12-01T00:00:00.000Z',
      completedAt: null,
      notes: null,
    },
  },
  {
    name: 'evidence submission',
    createCommand: 'eudr.evidence_submissions.create',
    updateCommand: 'eudr.evidence_submissions.update',
    finder: 'decryption',
    dateKeys: ['harvestFrom', 'harvestTo'],
    field: 'batchNumber',
    beforeValue: 'B-1',
    afterValue: 'B-2',
    concurrentValue: 'B-3',
    base: {
      supplierEntityId: 'supplier-1',
      supplierSnapshot: null,
      commodity: 'coffee',
      productMappingId: null,
      statementId: null,
      originCountry: 'BR',
      geolocation: null,
      quantityKg: '100.000',
      harvestFrom: '2026-01-01T00:00:00.000Z',
      harvestTo: null,
      producerName: null,
      attachmentIds: ['attachment-1'],
      plotIds: ['plot-1'],
      status: 'pending',
      completenessScore: 60,
      missingFields: ['geolocation'],
      notes: null,
    },
  },
  {
    name: 'due diligence statement',
    createCommand: 'eudr.statements.create',
    updateCommand: 'eudr.statements.update',
    finder: 'entityManager',
    dateKeys: ['submittedAt', 'referenceIssuedAt'],
    field: 'notes',
    beforeValue: 'Initial notes',
    afterValue: 'Edited notes',
    concurrentValue: 'Notes edited by another user',
    base: {
      title: 'Coffee import',
      commodity: 'coffee',
      referenceNumber: null,
      verificationNumber: null,
      status: 'draft',
      activityType: null,
      actorRole: null,
      referencedStatements: [],
      quantityKg: null,
      supplementaryUnit: null,
      supplementaryQuantity: null,
      orderId: null,
      submittedAt: null,
      referenceIssuedAt: null,
      orderSnapshot: null,
    },
  },
]

type EntityManagerMock = {
  fork: jest.Mock
  transactional: jest.Mock
  findOne: jest.Mock
  count: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  flush: jest.Mock
}

type Harness = {
  ctx: CommandRuntimeContext
  em: EntityManagerMock
  dataEngine: { setCustomFields: jest.Mock; markOrmEntityChange: jest.Mock }
}

function getCommand(id: string): CommandHandler<unknown, unknown> {
  const handler = commandRegistry.get(id) as CommandHandler<unknown, unknown> | null
  if (!handler) throw new Error(`Command ${id} not registered`)
  return handler
}

function buildSnapshot(fixture: EntityFixture, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: RECORD_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    ...fixture.base,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-02T00:00:00.000Z',
    deletedAt: null,
    custom: null,
    ...overrides,
  }
}

function toRecord(fixture: EntityFixture, snapshot: Snapshot): Record<string, unknown> {
  const { custom: _custom, ...fields } = snapshot
  const record: Record<string, unknown> = { ...fields }
  for (const key of [...fixture.dateKeys, 'createdAt', 'updatedAt', 'deletedAt']) {
    const value = record[key]
    record[key] = typeof value === 'string' ? new Date(value) : null
  }
  return record
}

function buildHarness(fixture: EntityFixture, record: Record<string, unknown> | null, custom: Record<string, unknown> = {}): Harness {
  const em: EntityManagerMock = {
    fork: jest.fn(),
    transactional: jest.fn(),
    findOne: jest.fn(async () => (fixture.finder === 'entityManager' ? record : null)),
    count: jest.fn(async () => 1),
    create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ ...data })),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  em.fork.mockReturnValue(em)
  em.transactional.mockImplementation(async (work: (tx: EntityManagerMock) => Promise<unknown>) => work(em))
  findOneWithDecryptionMock.mockImplementation(async () => (fixture.finder === 'decryption' ? record : null))
  loadCustomFieldSnapshotMock.mockImplementation(async () => custom)
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
  }
  const container = {
    resolve: (token: string) => {
      if (token === 'em') return em
      if (token === 'dataEngine') return dataEngine
      throw new Error(`Unexpected dependency: ${token}`)
    },
  }
  const ctx = {
    container,
    auth: { sub: 'user-1', tenantId: TENANT_ID, orgId: ORGANIZATION_ID },
    organizationScope: null,
    selectedOrganizationId: ORGANIZATION_ID,
    organizationIds: [ORGANIZATION_ID],
  } as unknown as CommandRuntimeContext
  return { ctx, em, dataEngine }
}

async function runUndo(commandId: string, harness: Harness, payload: Record<string, unknown>): Promise<unknown> {
  const command = getCommand(commandId)
  try {
    await command.undo!({ logEntry: { commandPayload: { undo: JSON.parse(JSON.stringify(payload)) } }, ctx: harness.ctx } as never)
    return null
  } catch (error) {
    return error
  }
}

function expectConflict(error: unknown) {
  expect(isCrudHttpError(error)).toBe(true)
  if (!isCrudHttpError(error)) return
  expect(error.status).toBe(409)
  expect(error.body).toEqual({ error: `translated:${CONFLICT_CODE}:${CONFLICT_FALLBACK}`, code: CONFLICT_CODE })
}

function expectNothingWritten(harness: Harness) {
  expect(harness.em.flush).not.toHaveBeenCalled()
  expect(harness.dataEngine.setCustomFields).not.toHaveBeenCalled()
  expect(harness.dataEngine.markOrmEntityChange).not.toHaveBeenCalled()
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe.each(fixtures)('eudr $name update undo', (fixture) => {
  const before = () => buildSnapshot(fixture, { [fixture.field]: fixture.beforeValue })
  const after = () => buildSnapshot(fixture, { [fixture.field]: fixture.afterValue, updatedAt: '2026-09-03T00:00:00.000Z' })

  it('refuses when another user changed the record after the logged update', async () => {
    const record = toRecord(fixture, buildSnapshot(fixture, {
      [fixture.field]: fixture.concurrentValue,
      updatedAt: '2026-09-04T00:00:00.000Z',
    }))
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.updateCommand, harness, { before: before(), after: after() })

    expectConflict(error)
    expect(record[fixture.field]).toBe(fixture.concurrentValue)
    expectNothingWritten(harness)
  })

  it('refuses when only a custom field changed after the logged update', async () => {
    const record = toRecord(fixture, after())
    const harness = buildHarness(fixture, record, { grade: 'B' })

    const error = await runUndo(fixture.updateCommand, harness, {
      before: buildSnapshot(fixture, { [fixture.field]: fixture.beforeValue, custom: { grade: 'A' } }),
      after: { ...after(), custom: { grade: 'A' } },
    })

    expectConflict(error)
    expect(record[fixture.field]).toBe(fixture.afterValue)
    expectNothingWritten(harness)
  })

  it('refuses when the record was deleted after the logged update', async () => {
    const record = toRecord(fixture, { ...after(), deletedAt: '2026-09-04T00:00:00.000Z' })
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.updateCommand, harness, { before: before(), after: after() })

    expectConflict(error)
    expect(record.deletedAt).toBeInstanceOf(Date)
    expectNothingWritten(harness)
  })

  it('refuses when the log entry has no after snapshot', async () => {
    const record = toRecord(fixture, after())
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.updateCommand, harness, { before: before(), after: null })

    expectConflict(error)
    expect(record[fixture.field]).toBe(fixture.afterValue)
    expectNothingWritten(harness)
  })

  it('restores the logged update when only the timestamp moved, as after undoing a newer update', async () => {
    const record = toRecord(fixture, { ...after(), updatedAt: '2026-09-05T00:00:00.000Z' })
    const harness = buildHarness(fixture, record, { grade: null, tags: [] })

    const error = await runUndo(fixture.updateCommand, harness, { before: before(), after: after() })

    expect(error).toBeNull()
    expect(record[fixture.field]).toBe(fixture.beforeValue)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'updated', entity: record }),
    )
  })

  it('compares multi-value custom fields regardless of order', async () => {
    const record = toRecord(fixture, after())
    const harness = buildHarness(fixture, record, { tags: ['b', 'a'] })

    const error = await runUndo(fixture.updateCommand, harness, {
      before: buildSnapshot(fixture, { [fixture.field]: fixture.beforeValue, custom: { tags: ['a'] } }),
      after: { ...after(), custom: { tags: ['a', 'b'] } },
    })

    expect(error).toBeNull()
    expect(record[fixture.field]).toBe(fixture.beforeValue)
  })

  it('reads the record under a tenant-scoped write lock', async () => {
    const record = toRecord(fixture, after())
    const harness = buildHarness(fixture, record)

    await runUndo(fixture.updateCommand, harness, { before: before(), after: after() })

    const where = { id: RECORD_ID, tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }
    const options = { lockMode: LockMode.PESSIMISTIC_WRITE, refresh: true }
    expect(harness.em.transactional).toHaveBeenCalledTimes(1)
    if (fixture.finder === 'decryption') {
      expect(findOneWithDecryptionMock).toHaveBeenCalledWith(harness.em, expect.anything(), where, options, {
        tenantId: TENANT_ID,
        organizationId: ORGANIZATION_ID,
      })
    } else {
      expect(harness.em.findOne).toHaveBeenCalledWith(expect.anything(), where, options)
    }
  })

  it('still re-creates a record that no longer exists', async () => {
    const harness = buildHarness(fixture, null)

    const error = await runUndo(fixture.updateCommand, harness, { before: before(), after: after() })

    expect(error).toBeNull()
    expect(harness.em.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: RECORD_ID, [fixture.field]: fixture.beforeValue }),
    )
    expect(harness.em.persist).toHaveBeenCalledTimes(1)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
  })
})

describe.each(fixtures)('eudr $name create undo', (fixture) => {
  const after = () => buildSnapshot(fixture, { [fixture.field]: fixture.afterValue })

  it('refuses to delete a record another user edited after it was created', async () => {
    const record = toRecord(fixture, buildSnapshot(fixture, {
      [fixture.field]: fixture.concurrentValue,
      updatedAt: '2026-09-04T00:00:00.000Z',
    }))
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.createCommand, harness, { after: after() })

    expectConflict(error)
    expect(record.deletedAt).toBeNull()
    expectNothingWritten(harness)
  })

  it('still deletes a record nobody changed since it was created', async () => {
    const record = toRecord(fixture, after())
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.createCommand, harness, { after: after() })

    expect(error).toBeNull()
    expect(record.deletedAt).toBeInstanceOf(Date)
    expect(harness.em.flush).toHaveBeenCalledTimes(1)
    expect(harness.dataEngine.markOrmEntityChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deleted', entity: record }),
    )
  })

  it('leaves an already deleted record alone', async () => {
    const deletedAt = '2026-09-04T00:00:00.000Z'
    const record = toRecord(fixture, { ...after(), deletedAt })
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.createCommand, harness, { after: after() })

    expect(error).toBeNull()
    expect(record.deletedAt).toEqual(new Date(deletedAt))
    expectNothingWritten(harness)
  })
})

function fixtureNamed(name: string): EntityFixture {
  const fixture = fixtures.find((entry) => entry.name === name)
  if (!fixture) throw new Error(`Unknown fixture ${name}`)
  return fixture
}

describe('eudr evidence submission undo and the completeness projection', () => {
  const fixture = fixtureNamed('evidence submission')

  it('restores an update when only the attachment-driven completeness projection changed, and recomputes it', async () => {
    const before = buildSnapshot(fixture, { batchNumber: 'B-1', originCountry: null })
    const after = buildSnapshot(fixture, { batchNumber: 'B-2', originCountry: 'BR', updatedAt: '2026-09-03T00:00:00.000Z' })
    const record = toRecord(fixture, { ...after, completenessScore: 90, missingFields: [], updatedAt: '2026-09-04T00:00:00.000Z' })
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.updateCommand, harness, { before, after })

    const expected = computeSubmissionCompleteness({
      originCountry: null,
      geolocation: null,
      quantityKg: '100.000',
      harvestFrom: new Date('2026-01-01T00:00:00.000Z'),
      harvestTo: null,
      producerName: null,
      attachmentIds: ['attachment-1'],
    }, { activePlotCount: 1, linkedAttachmentCount: undefined })
    expect(error).toBeNull()
    expect(record.batchNumber).toBe('B-1')
    expect(record.originCountry).toBeNull()
    expect(record.completenessScore).toBe(expected.score)
    expect(record.missingFields).toEqual(expected.missingFields)
    expect(harness.em.count).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: { $in: ['plot-1'] },
      tenantId: TENANT_ID,
      organizationId: ORGANIZATION_ID,
    }))
  })

  it('still deletes a created submission when only its completeness projection changed', async () => {
    const after = buildSnapshot(fixture, { batchNumber: 'B-1' })
    const record = toRecord(fixture, { ...after, completenessScore: 90, missingFields: [] })
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.createCommand, harness, { after })

    expect(error).toBeNull()
    expect(record.deletedAt).toBeInstanceOf(Date)
  })
})

describe('eudr due diligence statement update undo with a later status change', () => {
  const fixture = fixtureNamed('due diligence statement')

  it('answers with the status blocker rather than the generic conflict', async () => {
    const before = buildSnapshot(fixture, { notes: 'Initial notes' })
    const after = buildSnapshot(fixture, { notes: 'Edited notes', updatedAt: '2026-09-03T00:00:00.000Z' })
    const record = toRecord(fixture, { ...after, status: 'archived', updatedAt: '2026-09-04T00:00:00.000Z' })
    const harness = buildHarness(fixture, record)

    const error = await runUndo(fixture.updateCommand, harness, { before, after })

    expect(isCrudHttpError(error)).toBe(true)
    if (!isCrudHttpError(error)) return
    expect(error.status).toBe(409)
    expect(error.body).toEqual({
      error: 'translated:eudr.errors.archivedReadOnly:Archived statements are read-only.',
      code: 'eudr.errors.archivedReadOnly',
    })
    expect(record.status).toBe('archived')
    expectNothingWritten(harness)
  })
})
