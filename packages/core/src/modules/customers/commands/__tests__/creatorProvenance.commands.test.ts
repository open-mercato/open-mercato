jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (
    em: { find: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.find(entity, where, options),
  findOneWithDecryption: (
    em: { findOne: (entity: unknown, where: unknown, options?: unknown) => Promise<unknown> },
    entity: unknown,
    where: unknown,
    options?: unknown,
  ) => em.findOne(entity, where, options),
}))

jest.mock('@open-mercato/shared/lib/commands/flush', () => ({
  withAtomicFlush: async (
    _em: unknown,
    phases: Array<() => void | Promise<void>>,
  ) => {
    for (const phase of phases) await phase()
  },
}))

import type {
  CommandHandler,
  CommandRuntimeContext,
  CommandUndoLogEntry,
} from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'
import {
  CustomerCompanyProfile,
  CustomerDeal,
  CustomerEntity,
  CustomerPersonProfile,
} from '../../data/entities'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import '../people'
import '../companies'
import '../deals'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORGANIZATION_ID = '22222222-2222-4222-8222-222222222222'
const CREATOR_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_ACTOR_ID = '44444444-4444-4444-8444-444444444444'
const API_KEY_ID = '55555555-5555-4555-8555-555555555555'
const FORGED_ID = '66666666-6666-4666-8666-666666666666'
const PERSON_ID = '77777777-7777-4777-8777-777777777777'
const PERSON_PROFILE_ID = '88888888-8888-4888-8888-888888888888'
const COMPANY_ID = '99999999-9999-4999-8999-999999999999'
const COMPANY_PROFILE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const FIXED_DATE = new Date('2026-10-22T12:00:00.000Z')

type ResourceKind = 'person' | 'company' | 'deal'

type HarnessState = {
  entity: CustomerEntity | null
  personProfile: CustomerPersonProfile | null
  companyProfile: CustomerCompanyProfile | null
  deal: CustomerDeal | null
}

type MockEntityManager = {
  fork: () => MockEntityManager
  findOne: jest.Mock
  find: jest.Mock
  count: jest.Mock
  create: jest.Mock
  persist: jest.Mock
  remove: jest.Mock
  flush: jest.Mock
  nativeDelete: jest.Mock
  nativeUpdate: jest.Mock
  begin: jest.Mock
  commit: jest.Mock
  rollback: jest.Mock
  getReference: jest.Mock
  getMetadata: jest.Mock
}

function newCustomerEntity(kind: 'person' | 'company', id: string): CustomerEntity {
  return Object.assign(new CustomerEntity(), {
    id,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    kind,
    displayName: kind === 'person' ? 'Ada Lovelace' : 'Analytical Engines',
    description: null,
    ownerUserId: null,
    createdByUserId: CREATOR_ID,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
  })
}

function newPersonProfile(entity: CustomerEntity): CustomerPersonProfile {
  return Object.assign(new CustomerPersonProfile(), {
    id: PERSON_PROFILE_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    entity,
    firstName: 'Ada',
    lastName: 'Lovelace',
    preferredName: null,
    jobTitle: null,
    department: null,
    seniority: null,
    timezone: null,
    linkedInUrl: null,
    twitterUrl: null,
    company: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  })
}

function newCompanyProfile(entity: CustomerEntity): CustomerCompanyProfile {
  return Object.assign(new CustomerCompanyProfile(), {
    id: COMPANY_PROFILE_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    entity,
    legalName: null,
    brandName: null,
    domain: null,
    websiteUrl: null,
    industry: null,
    sizeBucket: null,
    taxId: null,
    annualRevenue: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
  })
}

function newDeal(): CustomerDeal {
  return Object.assign(new CustomerDeal(), {
    id: DEAL_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    title: 'New analytical engine',
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    createdByUserId: CREATOR_ID,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
    createdAt: FIXED_DATE,
    updatedAt: FIXED_DATE,
    deletedAt: null,
  })
}

function makeEntityManager(state: HarnessState): MockEntityManager {
  const em = {} as MockEntityManager
  em.fork = () => em
  em.findOne = jest.fn(async (entityType: unknown) => {
    if (entityType === Organization) return { id: ORGANIZATION_ID }
    if (entityType === CustomerEntity) return state.entity
    if (entityType === CustomerPersonProfile) return state.personProfile
    if (entityType === CustomerCompanyProfile) return state.companyProfile
    if (entityType === CustomerDeal) return state.deal
    return null
  })
  em.find = jest.fn(async () => [])
  em.count = jest.fn(async () => 0)
  em.create = jest.fn((entityType: unknown, values: Record<string, unknown>) => {
    if (entityType === CustomerEntity) {
      const kind = values.kind === 'company' ? 'company' : 'person'
      const entity = Object.assign(
        newCustomerEntity(kind, kind === 'person' ? PERSON_ID : COMPANY_ID),
        values,
      )
      state.entity = entity
      return entity
    }
    if (entityType === CustomerPersonProfile) {
      const entity = values.entity as CustomerEntity
      const profile = Object.assign(newPersonProfile(entity), values)
      state.personProfile = profile
      return profile
    }
    if (entityType === CustomerCompanyProfile) {
      const entity = values.entity as CustomerEntity
      const profile = Object.assign(newCompanyProfile(entity), values)
      state.companyProfile = profile
      return profile
    }
    if (entityType === CustomerDeal) {
      const deal = Object.assign(newDeal(), values)
      state.deal = deal
      return deal
    }
    return { ...values }
  })
  em.persist = jest.fn()
  em.remove = jest.fn()
  em.flush = jest.fn(async () => undefined)
  em.nativeDelete = jest.fn(async () => 0)
  em.nativeUpdate = jest.fn(async () => 0)
  em.begin = jest.fn(async () => undefined)
  em.commit = jest.fn(async () => undefined)
  em.rollback = jest.fn(async () => undefined)
  em.getReference = jest.fn((_entityType: unknown, id: string) => ({ id }))
  em.getMetadata = jest.fn(() => ({ get: () => ({ className: 'CustomerEntity' }) }))
  return em
}

function makeContext(
  em: MockEntityManager,
  auth: CommandRuntimeContext['auth'] = {
    sub: CREATOR_ID,
    tenantId: TENANT_ID,
    orgId: ORGANIZATION_ID,
  },
  overrides: Partial<CommandRuntimeContext> = {},
): CommandRuntimeContext {
  const dataEngine = {
    setCustomFields: jest.fn(async () => undefined),
    emitOrmEntityEvent: jest.fn(async () => undefined),
    markOrmEntityChange: jest.fn(),
    flushOrmEntityChanges: jest.fn(async () => undefined),
  }
  return {
    container: {
      resolve: <Resolved>(name: string | symbol): Resolved => {
        if (name === 'em') return em as Resolved
        if (name === 'dataEngine') return dataEngine as Resolved
        if (name === 'eventBus') return undefined as Resolved
        if (name === 'cache') return undefined as Resolved
        throw new Error(`[internal] Unexpected dependency: ${String(name)}`)
      },
    } as CommandRuntimeContext['container'],
    auth,
    organizationScope: null,
    selectedOrganizationId: auth?.orgId ?? null,
    organizationIds: null,
    ...overrides,
  }
}

function emptyState(): HarnessState {
  return { entity: null, personProfile: null, companyProfile: null, deal: null }
}

function existingState(kind: ResourceKind): HarnessState {
  if (kind === 'person') {
    const entity = newCustomerEntity('person', PERSON_ID)
    return { entity, personProfile: newPersonProfile(entity), companyProfile: null, deal: null }
  }
  if (kind === 'company') {
    const entity = newCustomerEntity('company', COMPANY_ID)
    return { entity, personProfile: null, companyProfile: newCompanyProfile(entity), deal: null }
  }
  return { entity: null, personProfile: null, companyProfile: null, deal: newDeal() }
}

function resourceId(kind: ResourceKind): string {
  if (kind === 'person') return PERSON_ID
  if (kind === 'company') return COMPANY_ID
  return DEAL_ID
}

function commandId(kind: ResourceKind, action: 'create' | 'update' | 'delete'): string {
  const collection = kind === 'person' ? 'people' : kind === 'company' ? 'companies' : 'deals'
  return `customers.${collection}.${action}`
}

function handler(kind: ResourceKind, action: 'create' | 'update' | 'delete'): CommandHandler {
  const registered = commandRegistry.get(commandId(kind, action)) as CommandHandler | undefined
  if (!registered) throw new Error(`[internal] ${commandId(kind, action)} not registered`)
  return registered
}

function createInput(kind: ResourceKind): Record<string, unknown> {
  const scope = { organizationId: ORGANIZATION_ID, tenantId: TENANT_ID }
  if (kind === 'person') return { ...scope, firstName: 'Ada', lastName: 'Lovelace' }
  if (kind === 'company') return { ...scope, displayName: 'Analytical Engines' }
  return { ...scope, title: 'New analytical engine' }
}

function personSnapshot(includeCreator = true): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    id: PERSON_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    displayName: 'Ada Lovelace',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
  }
  if (includeCreator) entity.createdByUserId = CREATOR_ID
  return {
    entity,
    profile: {
      id: PERSON_PROFILE_ID,
      firstName: 'Ada',
      lastName: 'Lovelace',
      preferredName: null,
      jobTitle: null,
      department: null,
      seniority: null,
      timezone: null,
      linkedInUrl: null,
      twitterUrl: null,
      companyEntityId: null,
    },
    companies: [],
    tagIds: [],
    addresses: [],
    comments: [],
    deals: [],
    activities: [],
    todos: [],
    interactions: [],
  }
}

function companySnapshot(includeCreator = true): Record<string, unknown> {
  const entity: Record<string, unknown> = {
    id: COMPANY_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    displayName: 'Analytical Engines',
    description: null,
    ownerUserId: null,
    primaryEmail: null,
    primaryPhone: null,
    status: null,
    lifecycleStage: null,
    source: null,
    temperature: null,
    renewalQuarter: null,
    nextInteractionAt: null,
    nextInteractionName: null,
    nextInteractionRefId: null,
    nextInteractionIcon: null,
    nextInteractionColor: null,
    isActive: true,
  }
  if (includeCreator) entity.createdByUserId = CREATOR_ID
  return {
    entity,
    profile: {
      id: COMPANY_PROFILE_ID,
      legalName: null,
      brandName: null,
      domain: null,
      websiteUrl: null,
      industry: null,
      sizeBucket: null,
      taxId: null,
      annualRevenue: null,
    },
    tagIds: [],
    deals: [],
    members: [],
    addresses: [],
    comments: [],
    activities: [],
    todos: [],
    interactions: [],
  }
}

function dealSnapshot(includeCreator = true): Record<string, unknown> {
  const deal: Record<string, unknown> = {
    id: DEAL_ID,
    organizationId: ORGANIZATION_ID,
    tenantId: TENANT_ID,
    title: 'New analytical engine',
    description: null,
    status: 'open',
    pipelineStage: null,
    pipelineId: null,
    pipelineStageId: null,
    valueAmount: null,
    valueCurrency: null,
    probability: null,
    expectedCloseAt: null,
    ownerUserId: null,
    source: null,
    closureOutcome: null,
    lossReasonId: null,
    lossNotes: null,
  }
  if (includeCreator) deal.createdByUserId = CREATOR_ID
  return { deal, people: [], primaryPersonEntityId: null, companies: [], transitions: [] }
}

function snapshot(kind: ResourceKind, includeCreator = true): Record<string, unknown> {
  if (kind === 'person') return personSnapshot(includeCreator)
  if (kind === 'company') return companySnapshot(includeCreator)
  return dealSnapshot(includeCreator)
}

function storedCreator(kind: ResourceKind, state: HarnessState): string | null | undefined {
  return kind === 'deal' ? state.deal?.createdByUserId : state.entity?.createdByUserId
}

function undoLog(
  kind: ResourceKind,
  action: 'create' | 'update' | 'delete',
  capturedSnapshot: Record<string, unknown>,
): CommandUndoLogEntry {
  const undo = action === 'create'
    ? { after: capturedSnapshot }
    : action === 'update'
      ? { before: capturedSnapshot, after: capturedSnapshot }
      : { before: capturedSnapshot }
  return { resourceId: resourceId(kind), commandPayload: { undo } }
}

async function replayMissingRow(
  kind: ResourceKind,
  action: 'create' | 'update' | 'delete',
  capturedSnapshot: Record<string, unknown>,
  ctx: CommandRuntimeContext,
): Promise<void> {
  const command = handler(kind, action)
  const logEntry = undoLog(kind, action, capturedSnapshot)
  if (action === 'create') {
    await command.redo?.({ input: {}, ctx, logEntry })
    return
  }
  await command.undo?.({ input: {}, ctx, logEntry })
}

describe('customers creator provenance commands', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  it.each<ResourceKind>(['person', 'company', 'deal'])('%s create stores the resolved human creator', async (kind) => {
    const state = emptyState()
    const em = makeEntityManager(state)

    await handler(kind, 'create').execute(createInput(kind), makeContext(em))

    expect(storedCreator(kind, state)).toBe(CREATOR_ID)
  })

  const nullCreatorContexts: Array<[
    string,
    CommandRuntimeContext['auth'],
    Partial<CommandRuntimeContext>,
  ]> = [
    ['API key', { sub: CREATOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isApiKey: true, userId: CREATOR_ID }, {}],
    ['sync_excel auth null', null, {}],
    ['system actor', { sub: CREATOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID }, { systemActor: true }],
  ]

  it.each<ResourceKind>(['person', 'company', 'deal'])('%s create stores null for untrusted contexts', async (kind) => {
    for (const [_label, auth, overrides] of nullCreatorContexts) {
      const state = emptyState()
      const em = makeEntityManager(state)

      await handler(kind, 'create').execute(createInput(kind), makeContext(em, auth, overrides))

      expect(storedCreator(kind, state)).toBeNull()
    }
  })

  const replayActors: Array<[string, CommandRuntimeContext['auth']]> = [
    ['different human', { sub: OTHER_ACTOR_ID, tenantId: TENANT_ID, orgId: ORGANIZATION_ID }],
    ['API key', { sub: `api_key:${API_KEY_ID}`, tenantId: TENANT_ID, orgId: ORGANIZATION_ID, isApiKey: true, keyId: API_KEY_ID }],
  ]

  it.each<ResourceKind>(['person', 'company', 'deal'])('%s rebuild paths preserve the captured creator for every replay actor', async (kind) => {
    for (const action of ['create', 'update', 'delete'] as const) {
      for (const [_label, auth] of replayActors) {
        const state = emptyState()
        const em = makeEntityManager(state)
        const ctx = makeContext(em, auth)

        await replayMissingRow(kind, action, snapshot(kind), ctx)

        expect(storedCreator(kind, state)).toBe(CREATOR_ID)
      }
    }
  })

  it.each<ResourceKind>(['person', 'company', 'deal'])('%s legacy snapshot without creator rebuilds with null', async (kind) => {
    const state = emptyState()
    const em = makeEntityManager(state)

    await replayMissingRow(kind, 'create', snapshot(kind, false), makeContext(em, {
      sub: OTHER_ACTOR_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    }))

    expect(storedCreator(kind, state)).toBeNull()
  })

  it.each<ResourceKind>(['person', 'company', 'deal'])('%s update strips a forged creator and keeps the stored value', async (kind) => {
    const state = existingState(kind)
    const em = makeEntityManager(state)

    await handler(kind, 'update').execute({
      id: resourceId(kind),
      createdByUserId: FORGED_ID,
    }, makeContext(em, {
      sub: OTHER_ACTOR_ID,
      tenantId: TENANT_ID,
      orgId: ORGANIZATION_ID,
    }))

    expect(storedCreator(kind, state)).toBe(CREATOR_ID)
  })
})
