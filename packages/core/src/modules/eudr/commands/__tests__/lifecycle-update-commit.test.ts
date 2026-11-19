import { randomUUID } from 'node:crypto'
import '../statements'
import '../mitigation-actions'
import '../risk-assessments'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { EudrDueDiligenceStatement, EudrRiskAssessment } from '../../data/entities'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(async () => []),
}))
jest.mock('@open-mercato/shared/lib/commands/customFieldSnapshots', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/commands/customFieldSnapshots'),
  loadCustomFieldSnapshot: jest.fn(async () => ({})),
}))
jest.mock('@open-mercato/shared/lib/commands/runCrudCommandWrite', () => ({
  runCrudCommandWrite: jest.fn(async ({ phases }: { phases: Array<() => Promise<void>> }) => {
    for (const phase of phases) await phase()
  }),
}))

const tenantId = randomUUID()
const organizationId = randomUUID()
const recordId = randomUUID()
const statementId = randomUUID()
const assessmentId = randomUUID()
const persistedAt = new Date('2020-01-01T00:00:00.000Z')
const fixtures = [
  { commandId: 'eudr.statements.update', field: 'status', before: 'available', after: 'withdrawn', eventId: 'eudr.due_diligence_statement.withdrawn' },
  { commandId: 'eudr.mitigation_actions.update', field: 'status', before: 'planned', after: 'completed', eventId: 'eudr.mitigation_action.completed' },
  { commandId: 'eudr.risk_assessments.update', field: 'conclusion', before: 'non_negligible', after: 'negligible', eventId: 'eudr.risk_assessment.concluded' },
]

function createHarness(fixture: typeof fixtures[number], failCommit: boolean) {
  const record: Record<string, unknown> = {
    id: recordId, tenantId, organizationId, title: 'Owned lifecycle fixture',
    statementId, riskAssessmentId: assessmentId, actionType: 'other',
    status: 'available', conclusion: 'non_negligible', countryRisks: [], criteria: {},
    overallTier: 'unknown', isSimplified: false, assessedAt: persistedAt, assessedByName: 'Analyst',
    reviewDueAt: persistedAt, dueDate: null, completedAt: null, description: null, notes: null,
    commodity: 'coffee', actorRole: 'operator', activityType: null, referencedStatements: [],
    referenceNumber: 'reference', verificationNumber: 'verification', referenceIssuedAt: new Date(),
    submittedAt: persistedAt, quantityKg: null, supplementaryUnit: null, supplementaryQuantity: null,
    orderId: null, orderSnapshot: null, createdAt: persistedAt, updatedAt: persistedAt, deletedAt: null,
    [fixture.field]: fixture.before,
  }
  const statement = { id: statementId, tenantId, organizationId, title: 'Related statement' }
  const assessment = { id: assessmentId, tenantId, organizationId }
  const state = { committed: false }
  const commitError = new Error('[internal] Deferred commit failure')
  const emittedAtCommit: boolean[] = []
  const emitEvent = jest.fn(async () => { emittedAtCommit.push(state.committed) })
  const queryBuilder: Record<string, unknown> = {}
  for (const method of ['selectFrom', 'select', 'where']) queryBuilder[method] = jest.fn(() => queryBuilder)
  queryBuilder.executeTakeFirst = jest.fn(async () => ({ total: 0 }))
  const em = { fork: jest.fn(), transactional: jest.fn(), findOne: jest.fn(), count: jest.fn(async () => 1), getKysely: jest.fn(() => queryBuilder) }
  em.fork.mockReturnValue(em)
  em.findOne.mockImplementation(async (entity: unknown, where: { id: string }) => {
    if (entity === EudrDueDiligenceStatement && where.id === statementId) return statement
    return record
  })
  em.transactional.mockImplementation(async (work: (entityManager: typeof em) => Promise<unknown>) => {
    const result = await work(em)
    if (failCommit) throw commitError
    state.committed = true
    return result
  })
  jest.mocked(findOneWithDecryption).mockImplementation(async (_entityManager, entity, where) => {
    if (entity === EudrRiskAssessment && (where as { id?: string }).id === assessmentId) return assessment as never
    return record as never
  })
  jest.mocked(findWithDecryption).mockResolvedValue([])
  const ctx = {
    container: { resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'eventBus') return { emitEvent }
      throw new Error(`[internal] Unexpected fixture dependency ${name}`)
    } },
    auth: { sub: randomUUID(), tenantId, orgId: organizationId },
    selectedOrganizationId: organizationId,
    organizationIds: [organizationId],
    organizationScope: null,
  } as unknown as CommandRuntimeContext
  const handler = commandRegistry.get(fixture.commandId) as CommandHandler<unknown, unknown> | undefined
  if (!handler) throw new Error('[internal] Lifecycle fixture command is not registered')
  return { handler, ctx, commitError, emitEvent, emittedAtCommit }
}

beforeEach(() => jest.clearAllMocks())

describe.each(fixtures)('$commandId lifecycle commit boundary', (fixture) => {
  it('does not publish a lifecycle event when commit fails after the write callback', async () => {
    const harness = createHarness(fixture, true)
    await expect(harness.handler.execute({ id: recordId, [fixture.field]: fixture.after }, harness.ctx)).rejects.toBe(harness.commitError)
    expect(harness.emitEvent).not.toHaveBeenCalled()
  })

  it('publishes exactly once after the transaction has committed', async () => {
    const harness = createHarness(fixture, false)
    await expect(harness.handler.execute({ id: recordId, [fixture.field]: fixture.after }, harness.ctx)).resolves.toMatchObject({ entityId: recordId })
    expect(harness.emitEvent).toHaveBeenCalledTimes(1)
    expect(harness.emitEvent).toHaveBeenCalledWith(fixture.eventId, expect.objectContaining({ id: recordId, tenantId, organizationId }), { persistent: true })
    expect(harness.emittedAtCommit).toEqual([true])
  })

  it('does not emit for an update without the lifecycle transition', async () => {
    const harness = createHarness(fixture, false)
    await harness.handler.execute({ id: recordId, [fixture.field]: fixture.before }, harness.ctx)
    expect(harness.emitEvent).not.toHaveBeenCalled()
  })
})
