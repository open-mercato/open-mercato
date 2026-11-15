jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (em: { find: (entity: unknown, filters: unknown) => unknown }, entity: unknown, filters: unknown) =>
    em.find(entity, filters),
  findOneWithDecryption: (em: { findOne: (entity: unknown, filters: unknown) => unknown }, entity: unknown, filters: unknown) =>
    em.findOne(entity, filters),
}))

jest.mock('@open-mercato/shared/lib/commands/helpers', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/commands/helpers')>('@open-mercato/shared/lib/commands/helpers'),
  emitCrudSideEffects: jest.fn(async () => {}),
  setCustomFieldsIfAny: jest.fn(async () => {}),
}))

jest.mock('../shared', () => ({
  ...jest.requireActual<typeof import('../shared')>('../shared'),
  invalidateDictionaryKindCaches: jest.fn(async () => {}),
}))

import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import {
  CustomerDeal,
  CustomerDealStageTransition,
  CustomerDictionaryEntry,
  CustomerPipeline,
  CustomerPipelineStage,
} from '../../data/entities'
import '../deals'
import '../pipeline-stages'

const ids = {
  tenant: '550e8400-e29b-41d4-a716-446655440001',
  organization: '550e8400-e29b-41d4-a716-446655440002',
  foreignTenant: '550e8400-e29b-41d4-a716-446655440003',
  foreignOrganization: '550e8400-e29b-41d4-a716-446655440004',
  pipeline: '550e8400-e29b-41d4-a716-446655440010',
  otherPipeline: '550e8400-e29b-41d4-a716-446655440011',
  stage: '550e8400-e29b-41d4-a716-446655440020',
  missing: '550e8400-e29b-41d4-a716-446655440099',
  deal: '550e8400-e29b-41d4-a716-446655440030',
  created: '550e8400-e29b-41d4-a716-446655440031',
  user: '550e8400-e29b-41d4-a716-446655440040',
}

type Row = Record<string, unknown>
type Assignment = { pipelineId?: string; pipelineStageId?: string }
type ReferenceCase = {
  name: string
  stages?: Row[]
  pipelines?: Row[]
  assignment: Assignment
  error: string
}

function pipeline(overrides: Row = {}): Row {
  return {
    id: ids.pipeline,
    tenantId: ids.tenant,
    organizationId: ids.organization,
    name: 'Local pipeline',
    ...overrides,
  }
}

function stage(overrides: Row = {}): Row {
  return {
    id: ids.stage,
    tenantId: ids.tenant,
    organizationId: ids.organization,
    pipelineId: ids.pipeline,
    label: 'Confidential stage',
    order: 2,
    ...overrides,
  }
}

function createHarness(input: { pipelines?: Row[]; stages?: Row[] } = {}) {
  const deal: Row = {
    id: ids.deal,
    tenantId: ids.tenant,
    organizationId: ids.organization,
    title: 'Unassigned deal',
    status: 'open',
    pipelineId: null,
    pipelineStageId: null,
    pipelineStage: null,
    deletedAt: null,
    updatedAt: new Date('2026-10-25T10:00:00.000Z'),
  }
  const initialDeal = { ...deal }
  const rows = new Map<unknown, Row[]>([
    [CustomerDeal, [deal]],
    [CustomerPipeline, input.pipelines ?? [pipeline()]],
    [CustomerPipelineStage, input.stages ?? [stage()]],
  ])
  const em = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, filters: Row) =>
      rows.get(entity)?.find((row) => Object.entries(filters).every(([key, value]) => row[key] === value)) ?? null),
    find: jest.fn(async () => []),
    create: jest.fn((entity: unknown, values: Row) => ({ id: ids.created, ...values })),
    upsert: jest.fn(async (entity: unknown, values: Row) => ({ id: ids.created, ...values })),
    persist: jest.fn(),
    nativeDelete: jest.fn(async () => 0),
    flush: jest.fn(async () => {}),
    begin: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
  }
  const eventBus = { emitEvent: jest.fn(async () => {}) }
  const container = {
    resolve: (name: string) => {
      if (name === 'em') return em
      if (name === 'dataEngine') return {}
      if (name === 'eventBus') return eventBus
      throw new Error(`[internal] Unexpected dependency ${name}`)
    },
  } as unknown as CommandRuntimeContext['container']
  const ctx: CommandRuntimeContext = {
    container,
    auth: { sub: ids.user, tenantId: ids.tenant, orgId: ids.organization },
    selectedOrganizationId: ids.organization,
    organizationScope: null,
    organizationIds: [ids.organization],
  }
  return { em, ctx, eventBus, deal, initialDeal }
}

function command(commandId: string) {
  const handler = commandRegistry.get(commandId)
  if (!handler) throw new Error(`[internal] Missing command ${commandId}`)
  return handler
}

function expectNoWrites(harness: ReturnType<typeof createHarness>) {
  expect(harness.em.create).not.toHaveBeenCalled()
  expect(harness.em.upsert).not.toHaveBeenCalled()
  expect(harness.em.persist).not.toHaveBeenCalled()
  expect(harness.em.flush).not.toHaveBeenCalled()
  expect(harness.em.commit).not.toHaveBeenCalled()
  expect(emitCrudSideEffects).not.toHaveBeenCalled()
  expect(setCustomFieldsIfAny).not.toHaveBeenCalled()
  expect(harness.eventBus.emitEvent).not.toHaveBeenCalled()
  expect(harness.deal).toEqual(harness.initialDeal)
}

const invalidReferences: ReferenceCase[] = [
  {
    name: 'a missing stage',
    stages: [],
    assignment: { pipelineStageId: ids.missing },
    error: 'Pipeline stage not found',
  },
  ...[
    { name: 'another tenant', overrides: { tenantId: ids.foreignTenant } },
    { name: 'another organization in the same tenant', overrides: { organizationId: ids.foreignOrganization } },
  ].flatMap(({ name, overrides }): ReferenceCase[] => [
    {
      name: `a stage in ${name} with its pipeline omitted`,
      stages: [stage(overrides)],
      assignment: { pipelineStageId: ids.stage },
      error: 'Pipeline stage not found',
    },
    {
      name: `a matching pipeline and stage in ${name}`,
      stages: [stage(overrides)],
      pipelines: [pipeline(overrides)],
      assignment: { pipelineId: ids.pipeline, pipelineStageId: ids.stage },
      error: 'Pipeline stage not found',
    },
    {
      name: `a pipeline alone in ${name}`,
      pipelines: [pipeline(overrides)],
      assignment: { pipelineId: ids.pipeline },
      error: 'Pipeline not found',
    },
    {
      name: `an in-scope stage whose parent pipeline belongs to ${name}`,
      pipelines: [pipeline(overrides)],
      assignment: { pipelineStageId: ids.stage },
      error: 'Pipeline not found',
    },
  ]),
  {
    name: 'a missing pipeline without a stage',
    pipelines: [],
    assignment: { pipelineId: ids.missing },
    error: 'Pipeline not found',
  },
  {
    name: 'an in-scope stage whose parent pipeline is missing',
    pipelines: [],
    assignment: { pipelineStageId: ids.stage },
    error: 'Pipeline not found',
  },
  {
    name: 'a stage belonging to another in-scope pipeline',
    pipelines: [pipeline(), pipeline({ id: ids.otherPipeline })],
    assignment: { pipelineId: ids.otherPipeline, pipelineStageId: ids.stage },
    error: 'Pipeline stage does not belong to the selected pipeline',
  },
]

describe.each(['create', 'update'] as const)('customers.deals.%s pipeline reference isolation', (action) => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each(invalidReferences)('rejects $name before writing deal, dictionary, transitions, or events', async (reference) => {
    const harness = createHarness(reference)
    const input = action === 'create'
      ? { tenantId: ids.tenant, organizationId: ids.organization, title: 'Rejected deal', ...reference.assignment }
      : { id: ids.deal, title: 'Rejected edit', ...reference.assignment }

    await expect(command(`customers.deals.${action}`).execute(input, harness.ctx)).rejects.toMatchObject({
      status: 400,
      body: { error: reference.error },
    })

    expectNoWrites(harness)
  })

  it('infers the pipeline from a valid same-scope stage', async () => {
    const harness = createHarness()
    const input = action === 'create'
      ? { tenantId: ids.tenant, organizationId: ids.organization, title: 'Valid deal', pipelineStageId: ids.stage }
      : { id: ids.deal, pipelineStageId: ids.stage }

    await command(`customers.deals.${action}`).execute(input, harness.ctx)

    expect(harness.em.findOne).toHaveBeenCalledWith(CustomerPipelineStage, {
      id: ids.stage,
      tenantId: ids.tenant,
      organizationId: ids.organization,
    })
    expect(harness.em.findOne).toHaveBeenCalledWith(CustomerPipeline, {
      id: ids.pipeline,
      tenantId: ids.tenant,
      organizationId: ids.organization,
    })
    const expectedAssignment = {
      pipelineId: ids.pipeline,
      pipelineStageId: ids.stage,
      pipelineStage: 'Confidential stage',
    }
    if (action === 'create') {
      expect(harness.em.create).toHaveBeenCalledWith(CustomerDeal, expect.objectContaining(expectedAssignment))
    } else {
      expect(harness.deal).toMatchObject(expectedAssignment)
    }
    expect(harness.em.upsert).toHaveBeenCalledWith(CustomerDictionaryEntry, expect.objectContaining({
      tenantId: ids.tenant,
      organizationId: ids.organization,
      value: 'Confidential stage',
    }), expect.anything())
    expect(harness.em.create).toHaveBeenCalledWith(CustomerDealStageTransition, expect.objectContaining({
      pipelineId: ids.pipeline,
      stageId: ids.stage,
      stageLabel: 'Confidential stage',
      stageOrder: 2,
    }))
    expect(emitCrudSideEffects).toHaveBeenCalledTimes(1)
  })

  it('preserves null assignments when pipeline and stage are omitted', async () => {
    const harness = createHarness({ pipelines: [], stages: [] })
    const input = action === 'create'
      ? { tenantId: ids.tenant, organizationId: ids.organization, title: 'Unassigned deal' }
      : { id: ids.deal, title: 'Still unassigned' }

    await command(`customers.deals.${action}`).execute(input, harness.ctx)

    const expectedAssignment = { pipelineId: null, pipelineStageId: null, pipelineStage: null }
    if (action === 'create') {
      expect(harness.em.create).toHaveBeenCalledWith(CustomerDeal, expect.objectContaining(expectedAssignment))
    } else {
      expect(harness.deal).toMatchObject(expectedAssignment)
    }
    expect(harness.em.upsert).not.toHaveBeenCalled()
    expect(harness.em.create.mock.calls.some(([entity]) => entity === CustomerDealStageTransition)).toBe(false)
  })
})

describe('customers.pipeline-stages.create parent pipeline isolation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it.each([
    { name: 'a missing pipeline', pipelines: [] },
    { name: 'another tenant', pipelines: [pipeline({ tenantId: ids.foreignTenant })] },
    { name: 'another organization', pipelines: [pipeline({ organizationId: ids.foreignOrganization })] },
  ])('rejects $name before creating a stage or dictionary entry', async ({ pipelines }) => {
    const harness = createHarness({ pipelines })

    await expect(command('customers.pipeline-stages.create').execute({
      tenantId: ids.tenant,
      organizationId: ids.organization,
      pipelineId: ids.pipeline,
      label: 'Rejected stage',
    }, harness.ctx)).rejects.toMatchObject({ status: 400, body: { error: 'Pipeline not found' } })

    expectNoWrites(harness)
    expect(harness.em.find).not.toHaveBeenCalled()
  })

  it('creates a stage when its parent pipeline is in the same scope', async () => {
    const harness = createHarness({ stages: [] })

    await expect(command('customers.pipeline-stages.create').execute({
      tenantId: ids.tenant,
      organizationId: ids.organization,
      pipelineId: ids.pipeline,
      label: 'Local stage',
    }, harness.ctx)).resolves.toEqual({ stageId: ids.created })

    expect(harness.em.findOne).toHaveBeenCalledWith(CustomerPipeline, {
      id: ids.pipeline,
      tenantId: ids.tenant,
      organizationId: ids.organization,
    })
    expect(harness.em.create).toHaveBeenCalledWith(CustomerPipelineStage, expect.objectContaining({
      pipelineId: ids.pipeline,
      tenantId: ids.tenant,
      organizationId: ids.organization,
      label: 'Local stage',
    }))
  })
})
