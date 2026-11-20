import { Entity, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import { z } from 'zod'
import { makeCrudRoute } from '../../factory'
import { getDerivedCrudRouteCapabilities } from '../factory-route-source'
import { bindDerivedCrudRouteSectionHosts, createDerivedCrudFormSectionFacade, defineCrudRouteSectionHost } from '../derived-route-host'

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
      submit: { proof }, delete: { proof },
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
