import { LockMode } from '@mikro-orm/core'
import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { z } from 'zod'
import { asValue, createContainer } from 'awilix'
import { ambientCommandExecutionMarker } from '../../../commands/types'
import type { CrudFormSectionServerModule } from '../../../../modules/form-sections'
import { makeCrudRoute } from '../../factory'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '../../optimistic-lock-headers'
import { registerApiInterceptors } from '../../interceptor-registry'
import { registerSyncSubscribers } from '../../sync-subscriber-store'
import { findCrudRouteSectionSource, getDerivedCrudRouteCapabilities } from '../factory-route-source'
import { bindDerivedCrudRouteSectionHosts, createDerivedCrudFormSectionFacade, defineCrudRouteSectionHost } from '../derived-route-host'
import { crudFormSectionHostKey } from '../composition'
import { getCrudFormSectionManifest, registerCrudFormSectionManifest } from '../manifest'
import { buildCrudFormSectionPolicyHeaders } from '../policy-headers'
import { encodeCurrentCrudFormSectionPolicyToken } from '../policy-token'

@Entity({ tableName: 'section_route_fixture' })
class ScopedRecord {
  @PrimaryKey({ type: 'uuid' })
  id!: string

  @Property({ type: 'uuid' })
  tenantId!: string

  @Property({ type: 'uuid' })
  organizationId!: string

  @Property({ name: 'updated_at', type: Date })
  updatedAt = new Date()
}

const requiredFeatures = ['example.manage']
const route = makeCrudRoute({
  metadata: {
    POST: { requireAuth: true, requireFeatures: requiredFeatures },
    PUT: { requireAuth: true, requireFeatures: requiredFeatures },
    DELETE: { requireAuth: true, requireFeatures: requiredFeatures },
  },
  orm: { entity: ScopedRecord, softDeleteField: null },
  events: { module: 'example', entity: 'todo', persistent: true },
  actions: {
    create: { commandId: 'example.todo.create' },
    update: { commandId: 'example.todo.update' },
    delete: { commandId: 'example.todo.delete' },
  },
})
const schema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('short'), name: z.string() }),
  z.object({ kind: z.literal('long'), name: z.string(), details: z.object({ notes: z.string() }) }),
])
const create = {
  hostId: 'example.todo',
  formVariant: 'detail',
  formOperation: 'create',
  hostDescriptorId: 'example.todo-create',
  route,
  sections: [{ id: 'details', writes: 'parent' }],
  authoritativeSchema: {
    id: 'example.todoCreateSchema', schema,
    fixtures: [{ kind: 'long', name: 'Fixture', details: { notes: 'value' } }],
  },
  projectedSchema: z.object({ kind: z.enum(['short', 'long']), name: z.string(), details: z.object({ notes: z.string() }).optional() }).strict(),
  submit: { proof: { finalInput: 'transactional-final-input/v1' } },
  maxBodyBytes: 2048,
  extensionSinkSupport: 'none',
  responseSchemas: { POST: z.object({ id: z.string() }) },
} as const

const hostAddress = { hostId: 'example.todo', formVariant: 'detail', formOperation: 'create' } as const
const policyPath = '/example/todos/section-policy'
const hostFacts = [{
  id: create.hostDescriptorId, roundTripId: 'example.todo-create@v1', hostResourceKind: 'example.todo',
  alternatives: [{ surface: {
    ...hostAddress, id: 'example.todo-base', orderedSectionIds: ['details'], callerIds: ['example.page'],
    contributionIds: [], ownershipFacts: [], mutationSurfaceIds: [], dependencies: [],
  } }],
}]

afterEach(() => {
  registerCrudFormSectionManifest([])
  registerApiInterceptors([])
  registerSyncSubscribers([])
})

describe('derived CRUD section host', () => {
  it('derives authoritative nested and conditional leaves without adding properties to the legacy route', () => {
    const declaration = defineCrudRouteSectionHost(create)
    const sections = bindDerivedCrudRouteSectionHosts({ hostFacts }, [{ declaration, route: policyPath }])
    expect(Object.keys(route)).toEqual(['metadata', 'GET', 'POST', 'PUT', 'DELETE'])
    expect(sections.hostFacts?.[0].alternatives?.[0].mutationSurfaces?.[0]).toMatchObject({
      id: 'example.todo-create.create', guardedFacade: { method: 'POST', routePattern: policyPath }, optimisticLock: 'none',
    })
    expect(getDerivedCrudRouteCapabilities(sections)[0].fact.requiredLeaves.map(({ payloadPath }) => payloadPath))
      .toEqual(['details.notes', 'kind', 'name'])
    const facade = createDerivedCrudFormSectionFacade([declaration], policyPath, ['POST'])
    expect(facade.metadata).toEqual({ path: policyPath, POST: route.metadata.POST })
    expect(facade.openApi.methods.POST).toMatchObject({
      responses: [{ status: 201 }],
      errors: expect.arrayContaining([{ status: 409, description: expect.any(String), schema: expect.anything() }]),
    })
    expect(Object.keys(facade.handlers)).toEqual(['POST'])
  })

  it('rejects lookalike factories, secondary writes, and unproved update contracts', () => {
    expect(() => defineCrudRouteSectionHost({ ...create, route: { ...route } })).toThrow(/original tenant-scoped makeCrudRoute/)
    expect(() => defineCrudRouteSectionHost({
      ...create, authoritativeSchema: {
        ...create.authoritativeSchema,
        fixtures: [...create.authoritativeSchema.fixtures, { kind: 'short', name: 'Fixture' }],
      },
    })).toThrow(/distinct finite form variants/)
    expect(() => defineCrudRouteSectionHost({
      ...create, sections: [{ id: 'details', writes: 'child' as 'none' }],
    })).toThrow(/secondary write/)
    expect(() => defineCrudRouteSectionHost({
      ...create, formOperation: 'update', expectedVersionField: 'expectedUpdatedAt', responseSchemas: { PUT: z.object({}) },
    })).toThrow(/atomic optimistic-lock proof/)
  })

  it('publishes a capability for original lifecycle hooks and refuses handlers targeting only the new façade', () => {
    const declaration = defineCrudRouteSectionHost(create)
    const sections = bindDerivedCrudRouteSectionHosts({ hostFacts }, [{ declaration, route: policyPath }])
    expect(getDerivedCrudRouteCapabilities(sections)).toHaveLength(1)
    registerApiInterceptors([{ moduleId: 'plugin', interceptors: [{
      id: 'plugin.original-route', targetRoute: 'example/todos', methods: ['POST'], before: async () => ({ ok: true }),
    }] }])
    expect(getDerivedCrudRouteCapabilities(sections)).toHaveLength(1)
    registerSyncSubscribers([{ metadata: { event: 'example.todo.created', sync: true }, handler: async () => {} }])
    expect(getDerivedCrudRouteCapabilities(sections)).toHaveLength(1)
    registerApiInterceptors([{ moduleId: 'plugin', interceptors: [{
      id: 'plugin.facade-route', targetRoute: 'example/todos/section-policy', methods: ['POST'], before: async () => ({ ok: true }),
    }] }])
    expect(getDerivedCrudRouteCapabilities(sections)).toEqual([])
  })

  it('requires an explicit command delete mode and refuses combining distinct original method grants', () => {
    const routeWithSplitGrants = makeCrudRoute({
      metadata: {
        PUT: { requireAuth: true, requireFeatures: ['example.write'] },
        DELETE: { requireAuth: true, requireFeatures: ['example.delete'] },
      },
      orm: { entity: ScopedRecord, softDeleteField: null },
      actions: { update: { commandId: 'example.todo.update' }, delete: { commandId: 'example.todo.delete' } },
    })
    const proof = {
      finalInput: 'transactional-final-input/v1', atomicity: 'pessimistic-write',
      contenderCoverage: ['update/update', 'update/delete'],
    } as const
    const update = {
      ...create, formOperation: 'update', mergesOmittedFieldsFromLockedRecord: true,
      route: routeWithSplitGrants, expectedVersionField: 'expected_updated_at',
      authoritativeSchema: {
        id: 'example.todoUpdateSchema', schema: z.object({ id: z.string(), name: z.string().optional() }),
        fixtures: [{ id: 'fixture-id', name: 'Fixture' }],
      },
      submit: { proof },
      responseSchemas: { PUT: z.object({}), DELETE: z.object({}) },
    } as const
    expect(() => defineCrudRouteSectionHost({
      ...update, delete: { proof, mode: undefined as unknown as 'soft' },
    })).toThrow(/explicit delegated command/)
    expect(() => defineCrudRouteSectionHost({
      ...update, delete: { proof, mode: 'hard' },
    })).toThrow(/different required features/)
  })

  it('derives required update and delete locks from the ORM version column', () => {
    const proof = {
      finalInput: 'transactional-final-input/v1', atomicity: 'pessimistic-write',
      contenderCoverage: ['update/update', 'update/delete'],
    } as const
    const declaration = defineCrudRouteSectionHost({
      ...create, formOperation: 'update', mergesOmittedFieldsFromLockedRecord: true,
      expectedVersionField: 'expected_updated_at',
      authoritativeSchema: {
        id: 'example.todoUpdateSchema', schema: z.object({ id: z.string(), name: z.string().optional() }),
        fixtures: [{ id: 'fixture-id', name: 'Fixture' }],
      },
      submit: { proof }, delete: { proof, mode: 'soft' },
      responseSchemas: { PUT: z.object({}), DELETE: z.object({}) },
    })
    const [host] = hostFacts
    const [alternative] = host.alternatives
    const bound = bindDerivedCrudRouteSectionHosts({
      hostFacts: [{ ...host, alternatives: [{ surface: { ...alternative.surface, formOperation: 'update' } }] }],
    }, [{ declaration, route: policyPath }])
    expect(bound.hostFacts?.[0].alternatives?.[0].mutationSurfaces?.map(({ requestOperation, optimisticLock }) => [requestOperation, optimisticLock]))
      .toEqual([['update', 'target-required'], ['delete', 'target-required']])
  })
})

function executableFixture(addHiddenLeaf = false, operation: 'create' | 'update' = 'create') {
  const isUpdate = operation === 'update'
  const method = isUpdate ? 'PUT' : 'POST'
  const recordId = isUpdate ? '123e4567-e89b-42d3-a456-426614174000' : undefined
  const version = isUpdate ? '2026-11-20T00:00:00.000Z' : undefined
  const address = { ...hostAddress, formOperation: operation }
  const schema = z.object({ name: z.string().min(1) }).strict()
  const authority = isUpdate ? schema.extend({
    id: z.string().uuid(), expectedUpdatedAt: z.string().optional(),
  }).partial({ name: true }) : schema
  const factory = makeCrudRoute({
    metadata: { [method]: { requireAuth: true } },
    orm: { entity: ScopedRecord, softDeleteField: null },
    events: { module: 'example', entity: 'todo', persistent: true },
    actions: {
      [operation]: {
        commandId: `example.todo.${operation}`,
        schema: authority.extend({ name: z.string().trim().min(1) }),
        mapInput({ parsed, ctx }) {
          ctx.selectedOrganizationId = 'unbound'
          if (ctx.auth) ctx.auth.orgId = 'unbound'
          return { ...parsed, name: String(parsed.name).toUpperCase(), ...(addHiddenLeaf ? { internal: true } : {}) }
        },
      },
    },
  })
  const declaration = defineCrudRouteSectionHost({
    ...create, formOperation: operation, route: factory, projectedSchema: schema,
    authoritativeSchema: { id: 'example.simple', schema: authority, fixtures: [{ name: 'name', ...(recordId ? { id: recordId } : {}) }] },
    ...(isUpdate ? {
      expectedVersionField: 'expectedUpdatedAt',
      mergesOmittedFieldsFromLockedRecord: true as const,
      submit: { proof: { finalInput: 'transactional-final-input/v1', atomicity: 'pessimistic-write', contenderCoverage: ['update/update', 'update/delete'] } },
    } : {}),
    responseSchemas: { [method]: z.object({ id: z.string() }) },
  })
  const [host] = hostFacts
  const baseline = { ...host.alternatives[0].surface, ...address, ownershipFacts: [{
    sectionId: 'details', payloadPaths: ['name'], customFieldOwnership: { mode: 'none' as const },
  }] }
  const sectionId = 'extra'
  const contributionId = 'example.extra'
  const capabilityId = 'example.extra-display'
  const requiredSectionLeaves = isUpdate ? [] : [{ sectionId: 'details', payloadPath: 'name' }]
  const modules: CrudFormSectionServerModule[] = [{
    moduleId: 'example',
    sections: bindDerivedCrudRouteSectionHosts({
      hostFacts: [{ ...host, alternatives: [
        { surface: baseline, requiredSectionLeaves },
        {
          surface: { ...baseline, id: 'todo.policy', orderedSectionIds: ['details', sectionId], contributionIds: [contributionId] },
          requiredSectionLeaves,
        },
      ] }],
      contributedOverrides: { [`example.todo/detail/${operation}/extra`]: { operation: 'add', contributionId } },
      contributionFacts: [{
        id: contributionId, address: { ...address, sectionId }, operation: 'add', roundTripId: 'example.extra@v1',
        requiredCapabilities: [{ capabilityId, protocol: 'crud-form-sections/v1', modes: ['display-only'] }],
      }],
      displayPolicies: [{
        ...address, capabilityId, protocol: 'crud-form-sections/v1', roundTripId: 'example.extra@v1',
        modes: ['display-only'], payloadPaths: [], customFieldOwnership: { mode: 'none' },
        mutationSurfaces: [], providedDataContractIds: [], allowNoopSubmit: false, requiredLeaves: [], extensionSinkSupport: 'none',
      }],
    }, [{ declaration, route: policyPath }]),
  }]
  registerCrudFormSectionManifest(modules)
  const manifest = getCrudFormSectionManifest()
  const policy = manifest.policies.get(crudFormSectionHostKey(address))
  if (!policy) throw new Error('[internal] missing fixture policy')
  const policyToken = encodeCurrentCrudFormSectionPolicyToken({
    address, host: { hostResourceKind: 'example.todo', hostResourceId: recordId }, policy, fingerprint: manifest.ledger.fingerprint,
  })
  if (!policyToken) throw new Error('[internal] fixture policy could not encode')
  const headers = buildCrudFormSectionPolicyHeaders({
    policyToken, fingerprint: manifest.ledger.fingerprint, requestOperation: operation,
    hostResourceKind: 'example.todo', hostResourceId: recordId,
    mutationResourceKind: 'example.todo', mutationResourceId: recordId, mutationSurfaceId: `example.todo-create.${operation}`,
  }, { 'content-type': 'application/json', ...(version ? { [OPTIMISTIC_LOCK_HEADER_NAME]: version } : {}) })

  const events: string[] = []
  let active = false
  const record = { id: recordId, tenantId: 'tenant', organizationId: 'org', updatedAt: version, name: 'Previous' }
  const readRecord = jest.fn(async () => record)
  const readLocked = jest.fn(async () => {
    expect(active).toBe(true)
    return record
  })
  const em = {
    findOne: readLocked,
    async begin() { active = true; events.push('begin') },
    async commit() { active = false; events.push('commit') },
    async rollback() { active = false; events.push('rollback') },
    async flush() {},
    isInTransaction: () => active,
  }
  const container = createContainer()
  container.register({
    em: asValue({ findOne: readRecord, fork: () => em }),
    rbacService: asValue({ userHasAllFeatures: async () => true, getGrantedFeatures: async () => [] }),
  })
  const source = findCrudRouteSectionSource(factory)
  if (!source) throw new Error('[internal] missing fixture factory association')
  jest.spyOn(source, 'requestContext').mockResolvedValue({
    auth: { sub: 'actor', tenantId: 'tenant', orgId: 'org' },
    selectedOrganizationId: 'org', organizationIds: ['org'], organizationScope: null, container,
  })
  const execute = jest.spyOn(source, 'execute').mockImplementation(async (_op, input, ctx) => {
    if (!ctx.transactionalEm) throw new Error('[internal] fixture command requires EM')
    await ctx.beforeTransactionalWrite?.(ctx.transactionalEm, input)
    events.push('write')
    const result = { id: 'created' }
    const logEntry = {
      id: 'committed-log', undoToken: 'fixture-undo', commandId: 'example.todo.create', resourceKind: 'example.todo',
      resourceId: result.id, createdAt: '2026-11-20T00:00:00.000Z',
    }
    return {
      result, logEntry,
      ambient: {
        [ambientCommandExecutionMarker]: true, tentativeResult: result, logEntry,
        finalizedResult() {
          expect(active).toBe(false)
          return result
        },
      },
    }
  })
  const facade = createDerivedCrudFormSectionFacade([declaration], policyPath, [method])
  const request = new Request(`https://example.invalid/api${policyPath}`, {
    method, headers, body: JSON.stringify({ name: '  Example ', ...(recordId ? { id: recordId } : {}) }),
  })
  return { response: () => facade.handlers[method]!(request), events, execute, readLocked, recordId }

}

describe('derived façade command pipeline', () => {
  it('dispatches the original parsed and mapped values and attaches committed undo metadata', async () => {
    const fixture = executableFixture()
    const response = await fixture.response()
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 'created' })
    expect(response.headers.get('x-om-operation')).toBeTruthy()
    expect(fixture.execute).toHaveBeenCalledWith('create', { name: 'EXAMPLE' },
      expect.objectContaining({ selectedOrganizationId: 'org', auth: expect.objectContaining({ orgId: 'org' }) }))
    expect(fixture.events).toEqual(['begin', 'write', 'commit'])
  })

  it('passes the proven route lock requirement to a versioned update command', async () => {
    const fixture = executableFixture(false, 'update')
    expect((await fixture.response()).status).toBe(200)
    expect(fixture.execute).toHaveBeenCalledWith('update', expect.objectContaining({
      id: fixture.recordId, expectedUpdatedAt: '2026-11-20T00:00:00.000Z',
    }), expect.objectContaining({ crudFormSectionTargetVersionRequired: true }))
  })

  it('rolls back before dispatch when the original mapper adds an undeclared leaf', async () => {
    const fixture = executableFixture(true)
    const response = await fixture.response()
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'extension_policy_mismatch', code: 'extension_policy_mismatch' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.events).toEqual(['begin', 'rollback'])
  })

  it('runs original API and synchronous hooks around the owned write and uses the transformed request', async () => {
    const fixture = executableFixture()
    registerApiInterceptors([{ moduleId: 'plugin', interceptors: [{
      id: 'plugin.original', targetRoute: 'example/todos', methods: ['POST'], timeoutMs: 200,
      before: async (request, context) => {
        expect(request.body).toEqual({ name: 'Example' })
        expect(context.em.isInTransaction()).toBe(true)
        fixture.events.push('api-before')
        return { ok: true, body: { name: 'allowed' }, metadata: { original: true } }
      },
      after: async (_request, _response, context) => {
        expect(context.em.isInTransaction()).toBe(false)
        expect(context.metadata).toEqual({ original: true })
        fixture.events.push('api-after')
        return { merge: { decorated: true } }
      },
    }] }])
    registerSyncSubscribers([
      { metadata: { event: 'example.todo.creating', sync: true }, handler: async ({ em, payload }) => {
        expect(em.isInTransaction()).toBe(true)
        expect(payload).toEqual({ name: 'ALLOWED' })
        fixture.events.push('sync-before')
        return { ok: true, modifiedPayload: { name: 'SUBSCRIBER' } }
      } },
      { metadata: { event: 'example.todo.created', sync: true }, handler: async ({ em, resourceId }) => {
        expect(em.isInTransaction()).toBe(false)
        expect(resourceId).toBe('created')
        fixture.events.push('sync-after')
      } },
    ])
    const response = await fixture.response()
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ id: 'created', decorated: true })
    expect(fixture.execute.mock.calls[0]?.[1]).toEqual({ name: 'SUBSCRIBER' })
    expect(fixture.events).toEqual(['begin', 'api-before', 'sync-before', 'write', 'commit', 'sync-after', 'api-after'])
  })

  it('gives original update subscribers a scoped previous row locked inside the write transaction', async () => {
    const fixture = executableFixture(false, 'update')
    registerSyncSubscribers([{
      metadata: { event: 'example.todo.updating', sync: true },
      handler: async ({ em, previousData }) => {
        expect(em.isInTransaction()).toBe(true)
        expect(previousData).toMatchObject({ id: fixture.recordId, organizationId: 'org', name: 'Previous' })
        return { ok: false, status: 422, message: 'Fixture veto' }
      },
    }])
    const response = await fixture.response()
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'Fixture veto' })
    expect(fixture.readLocked).toHaveBeenCalledWith(ScopedRecord,
      { id: fixture.recordId, tenantId: 'tenant', organizationId: 'org' },
      { lockMode: LockMode.PESSIMISTIC_WRITE })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.events).toEqual(['begin', 'rollback'])
  })

  it('keeps an original API veto in force on the protected route', async () => {
    const fixture = executableFixture()
    registerApiInterceptors([{ moduleId: 'plugin', interceptors: [{
      id: 'plugin.veto', targetRoute: 'example/todos', methods: ['POST'], timeoutMs: 200,
      before: async () => ({ ok: false, statusCode: 422, message: 'Fixture veto' }),
    }] }])
    const response = await fixture.response()
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ error: 'Fixture veto' })
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.events).toEqual(['begin', 'rollback'])
  })

  it('refuses a façade-only API interceptor registered after the policy was published', async () => {
    const fixture = executableFixture()
    registerApiInterceptors([{ moduleId: 'plugin', interceptors: [{
      id: 'plugin.late', targetRoute: 'example/todos/section-policy', methods: ['POST'], before: async () => ({ ok: true }),
    }] }])
    const response = await fixture.response()
    expect(response.status).toBe(404)
    expect(fixture.execute).not.toHaveBeenCalled()
    expect(fixture.events).toEqual([])
  })
})
