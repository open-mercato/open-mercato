/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM, type PostgreSqlDriver } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { decryptCustomFieldValue } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { CustomEntity, CustomFieldDef, CustomFieldValue, EncryptionMap } from '@open-mercato/core/modules/entities/data/entities'
import * as customerEntities from '../../../data/entities'
import { CUSTOMER_ENTITY_ID, PERSON_ENTITY_ID } from '../../../lib/customFieldRouting'
import '../../../commands/people'
import { POST, PUT } from '../route'

const mockResolve = jest.fn()
const mockActor = { sub: randomUUID(), tenantId: randomUUID(), orgId: randomUUID(), roles: ['admin'] }

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({ resolve: mockResolve }),
}))
jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: async () => mockActor,
  getAuthFromCookies: async () => mockActor,
}))
jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: async () => ({
    selectedId: mockActor.orgId,
    filterIds: [mockActor.orgId],
    allowedIds: [mockActor.orgId],
    tenantId: mockActor.tenantId,
  }),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('people CRUD with an unavailable custom-field encryption key', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM<PostgreSqlDriver>

  beforeAll(async () => {
    jest.replaceProperty(process, 'env', { ...process.env, TENANT_DATA_ENCRYPTION: 'yes' })
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16-alpine')
      .withEnvironment({ POSTGRES_DB: 'customer_test', POSTGRES_USER: 'customer_test', POSTGRES_PASSWORD: 'customer_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      entities: [...Object.values(customerEntities), CustomEntity, CustomFieldDef, CustomFieldValue, EncryptionMap],
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'customer_test',
      user: 'customer_test',
      password: 'customer_test',
    })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
      jest.restoreAllMocks()
    }
  })

  it('rolls back rejected POST and PUT and commits each retry after key recovery', async () => {
    const scope = { tenantId: mockActor.tenantId, organizationId: mockActor.orgId }
    const em = orm.em.fork()
    em.create(CustomFieldDef, { ...scope, entityId: CUSTOMER_ENTITY_ID, key: 'reference', kind: 'text' })
    em.create(CustomFieldDef, { ...scope, entityId: PERSON_ENTITY_ID, key: 'protected', kind: 'text', configJson: { encrypted: true } })
    await em.flush()
    const key = Buffer.alloc(32, 3).toString('base64')
    const getDek = jest.fn()
    const encryption = new TenantDataEncryptionService(em, {
      kms: { getTenantDek: getDek, createTenantDek: getDek, isHealthy: () => true },
    })
    const bus = { emitEvent: jest.fn(async () => undefined) }
    const commandBus = new CommandBus()
    const dataEngine = new DefaultDataEngine(em, { resolve: mockResolve } as unknown as AwilixContainer)
    const markChange = jest.spyOn(dataEngine, 'markOrmEntityChange')
    mockResolve.mockImplementation((name: string) => {
      switch (name) {
        case 'em': return em
        case 'dataEngine': return dataEngine
        case 'tenantEncryptionService': return encryption
        case 'eventBus': return bus
        case 'crudMutationGuardService': return null
        case 'rbacService': return { userHasAllFeatures: async () => true }
        case 'commandBus': return commandBus
        default: throw new Error(`[internal] unexpected resolve(${name})`)
      }
    })

    const getPeople = async () => (await orm.em.fork().find(customerEntities.CustomerEntity, scope))
      .map(({ id, displayName, updatedAt }) => ({ id, displayName, updatedAt }))
    const getProfiles = async () => (await orm.em.fork().find(customerEntities.CustomerPersonProfile, scope))
      .map(({ id, department, updatedAt }) => ({ id, department, updatedAt }))
    const getFields = () => orm.em.fork().find(CustomFieldValue, scope, { orderBy: { fieldKey: 'asc' } })
    const request = (method: 'POST' | 'PUT', body: Record<string, unknown>) => new Request('http://localhost/api/customers/people', {
      method,
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    })
    const rejectKey = () => {
      encryption.invalidateDek(scope.tenantId)
      getDek.mockRejectedValue(new Error('[internal] key service unavailable'))
    }
    const restoreKey = () => getDek.mockResolvedValue({ tenantId: scope.tenantId, key, fetchedAt: Date.now() })
    const create = { firstName: 'Ada', lastName: 'Example', cf_reference: 'original', cf_protected: 'initial' }

    rejectKey()
    const rejectedCreate = await POST(request('POST', create))
    expect(rejectedCreate.status).toBe(503)
    expect(await rejectedCreate.json()).toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' })
    expect(await getPeople()).toHaveLength(0)
    expect(await getProfiles()).toHaveLength(0)
    expect(await getFields()).toHaveLength(0)
    expect(markChange).not.toHaveBeenCalled()
    expect(bus.emitEvent).not.toHaveBeenCalled()

    restoreKey()
    const created = await POST(request('POST', create))
    expect(created.status).toBe(201)
    const { id, personId } = (await created.json()) as { id: string; personId: string }
    expect(bus.emitEvent).toHaveBeenCalledWith('customers.customer_person_profile.updated', { id: personId, ...scope }, expect.any(Object))
    expect(await getPeople()).toHaveLength(1)
    expect(await getProfiles()).toHaveLength(1)
    const beforePeople = await getPeople()
    const beforeProfiles = await getProfiles()
    const before = await getFields()
    expect(before).toHaveLength(2)
    expect(before[0]?.valueText).not.toBe('initial')
    expect(await decryptCustomFieldValue(before[0]?.valueText, scope.tenantId, encryption)).toBe('initial')
    expect(before[1]?.valueText).toBe('original')
    markChange.mockClear()
    bus.emitEvent.mockClear()

    const update = { id, displayName: 'Ada Updated', department: 'Engineering', cf_reference: 'updated', cf_protected: 'replacement' }
    rejectKey()
    const rejectedUpdate = await PUT(request('PUT', update))
    expect(rejectedUpdate.status).toBe(503)
    expect(await rejectedUpdate.json()).toMatchObject({ code: 'ENCRYPTION_UNAVAILABLE' })
    expect(await getPeople()).toEqual(beforePeople)
    expect(await getProfiles()).toEqual(beforeProfiles)
    expect(await getFields()).toEqual(before)
    expect(markChange).not.toHaveBeenCalled()
    expect(bus.emitEvent).not.toHaveBeenCalled()

    restoreKey()
    const updated = await PUT(request('PUT', update))
    expect(updated.status).toBe(200)
    expect(await getPeople()).toEqual([expect.objectContaining({ displayName: 'Ada Updated' })])
    expect(await getProfiles()).toEqual([expect.objectContaining({ department: 'Engineering' })])
    const after = await getFields()
    expect(after).toHaveLength(2)
    expect(after[0]?.valueText).not.toBe(before[0]?.valueText)
    expect(after[0]?.valueText).not.toBe('replacement')
    expect(await decryptCustomFieldValue(after[0]?.valueText, scope.tenantId, encryption)).toBe('replacement')
    expect(after[1]?.valueText).toBe('updated')
  })
})
