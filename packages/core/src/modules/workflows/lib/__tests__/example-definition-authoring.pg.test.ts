import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { asClass, asValue, createContainer, InjectionMode } from 'awilix'
import { Organization, Tenant } from '@open-mercato/core/modules/directory/data/entities'
import { DefaultOrganizationHierarchyService } from '@open-mercato/core/modules/directory/services/organizationHierarchyService'
import { WorkflowDefinition, WorkflowEventTrigger } from '../../data/entities'
import { loadTriggersForTenant } from '../event-trigger-service'
import { createWorkflowExampleAuthoring, type CreateExampleWorkflowDefinitionInput } from '../example-definition-authoring'
import { acquireWorkflowsPgDatabase, runsAgainstPostgres, type WorkflowsPgDatabase } from './workflowsPgDatabase'

const maybe = runsAgainstPostgres ? describe : describe.skip

const definition = {
  steps: [
    { stepId: 'start', stepName: 'Start', stepType: 'START' },
    { stepId: 'end', stepName: 'End', stepType: 'END' },
  ],
  transitions: [
    { transitionId: 'start-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' },
  ],
  triggers: [
    { triggerId: 'example-created', name: 'Example created', eventPattern: 'example.record.created', enabled: true },
  ],
}

maybe('Workflows example authoring against PostgreSQL', () => {
  jest.setTimeout(120_000)
  const databaseName = `om_wf_examples_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let database: WorkflowsPgDatabase
  let admin: MikroORM
  let orm: MikroORM

  beforeAll(async () => {
    database = await acquireWorkflowsPgDatabase()
    const options = {
      entities: [Organization, Tenant, WorkflowDefinition, WorkflowEventTrigger],
      metadataProvider: ReflectMetadataProvider,
      debug: false,
    }
    admin = await MikroORM.init({ ...options, clientUrl: database.url })
    await admin.em.getConnection().execute(`create database "${databaseName}"`)
    const databaseUrl = new URL(database.url)
    databaseUrl.pathname = `/${databaseName}`
    orm = await MikroORM.init({ ...options, clientUrl: databaseUrl.toString() })
    await orm.schema.create()
  }, 120_000)

  afterAll(async () => {
    await orm?.close(true)
    await admin?.em.getConnection().execute(`drop database if exists "${databaseName}"`)
    await admin?.close(true)
    await database?.release()
  })

  async function makeFixture(tenantId?: string, em = orm.em.fork()): Promise<CreateExampleWorkflowDefinitionInput> {
    const tenant = tenantId
      ? em.getReference(Tenant, tenantId)
      : em.create(Tenant, { name: 'Workflow example tenant' })
    const organization = em.create(Organization, { name: 'Workflow example organization', tenant })
    await em.persist(organization).flush()
    return {
      tenantId: tenant.id,
      organizationId: organization.id,
      fixture: {
        workflowId: 'workflow-example',
        workflowName: 'Editable example',
        version: 1,
        definition,
        metadata: {
          category: 'Examples',
          generatedBy: { module: 'agent_orchestrator', ownerId: 'never-persisted' },
        },
        grantedFeatures: ['auth.*'],
        createdBy: 'never-persisted',
      },
    }
  }

  function authoring(em: EntityManager) {
    const container = createContainer({ injectionMode: InjectionMode.CLASSIC })
    container.register({
      em: asValue(em),
      organizationHierarchyService: asClass(DefaultOrganizationHierarchyService).scoped(),
    })
    return createWorkflowExampleAuthoring(container)
  }

  test('retains an existing soft-deleted newer version and user edits', async () => {
    const input = await makeFixture()
    const em = orm.em.fork()
    const existing = em.create(WorkflowDefinition, {
      id: randomUUID(),
      workflowId: 'workflow-example',
      workflowName: 'Edited example',
      version: 3,
      deletedAt: new Date(),
      enabled: false,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      definition,
    })
    await em.persist(existing).flush()

    expect(await authoring(em).createExampleDefinitionIfAbsent(em, input)).toBe('already_exists')

    const rows = await orm.em.fork().find(WorkflowDefinition, { tenantId: input.tenantId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: existing.id, version: 3, workflowName: 'Edited example', enabled: false })
    expect(rows[0].deletedAt).toBeInstanceOf(Date)
  })

  test('arbitrates concurrent versions and scopes with the persisted key', async () => {
    const input = await makeFixture()
    const otherOrg = await makeFixture(input.tenantId)
    const otherTenant = await makeFixture()
    const first = orm.em.fork({ cloneEventManager: true })
    const second = orm.em.fork({ cloneEventManager: true })
    const concurrentInsert = Promise.withResolvers<void>()
    let arrivals = 0
    const rendezvous = {
      getSubscribedEntities: () => [WorkflowDefinition],
      async beforeCreate() {
        arrivals += 1
        if (arrivals === 2) concurrentInsert.resolve()
        await concurrentInsert.promise
      },
    }
    first.getEventManager().registerSubscriber(rendezvous)
    second.getEventManager().registerSubscriber(rendezvous)

    const results = await Promise.all([
      authoring(first).createExampleDefinitionIfAbsent(first, input),
      authoring(second).createExampleDefinitionIfAbsent(second, input),
    ])
    expect(results.sort()).toEqual(['already_exists', 'created'])

    const em = orm.em.fork()
    await em.transactional(async (transaction) => {
      await expect(authoring(transaction).createExampleDefinitionIfAbsent(transaction, otherOrg))
        .rejects.toThrow('[internal] Workflow example version conflicts with an existing definition.')
      expect(await transaction.count(WorkflowDefinition, {
        tenantId: otherOrg.tenantId, organizationId: otherOrg.organizationId,
      })).toBe(0)
    })
    expect(await authoring(em).createExampleDefinitionIfAbsent(em, otherTenant)).toBe('created')

    const rows = await orm.em.fork().find(WorkflowDefinition, { tenantId: input.tenantId })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      version: 1, organizationId: input.organizationId, lifecycle: 'published', enabled: true,
      metadata: { category: 'Examples' }, definition,
    })
    expect(rows[0].metadata).not.toHaveProperty('generatedBy')
    expect(rows[0].grantedFeatures).toBeNull()
    expect(rows[0].createdBy).toBeNull()
  })

  test('rejects invalid fixtures and a valid organization ID under another tenant', async () => {
    const input = await makeFixture()
    const otherTenant = await makeFixture()
    const em = orm.em.fork()
    const service = authoring(em)
    await expect(service.createExampleDefinitionIfAbsent(em, { ...input, organizationId: 'invalid-id' }))
      .rejects.toThrow('[internal] Invalid workflow example input.')
    await expect(service.createExampleDefinitionIfAbsent(em, { ...input, organizationId: otherTenant.organizationId }))
      .rejects.toThrow('[internal] Invalid organization scope for workflow example.')
    await expect(service.createExampleDefinitionIfAbsent(em, {
      ...input, fixture: { workflowId: 'workflow-example', workflowName: 'Bad example', definition: { steps: [] } },
    })).rejects.toThrow('[internal] Invalid workflow example input.')
    await expect(service.createExampleDefinitionIfAbsent(em, {
      ...input, fixture: { workflowId: 'workflow-example', workflowName: 'Bad version', definition, version: 2 },
    })).rejects.toThrow('[internal] Invalid workflow example input.')
    expect(await em.count(WorkflowDefinition, { tenantId: input.tenantId })).toBe(0)
  })

  test('validates a new organization on the caller setup transaction', async () => {
    const caller = orm.em.fork()
    const observer = orm.em.fork()
    await caller.begin()
    try {
      const input = await makeFixture(undefined, caller)
      expect(await observer.count(Organization, { id: input.organizationId })).toBe(0)
      expect(await authoring(observer).createExampleDefinitionIfAbsent(caller, input)).toBe('created')
      expect(await observer.count(WorkflowDefinition, { tenantId: input.tenantId })).toBe(0)
      await caller.commit()
      expect(await observer.count(WorkflowDefinition, { tenantId: input.tenantId })).toBe(1)
    } finally {
      if (caller.isInTransaction()) await caller.rollback()
    }
  })

  test('fresh trigger reads observe only committed definitions', async () => {
    const input = await makeFixture()
    const rolledBack = await makeFixture()
    const em = orm.em.fork()
    const observer = orm.em.fork({ disableContextResolution: true })
    const findTriggers = async (scope: CreateExampleWorkflowDefinitionInput) => {
      const outsideTransaction = observer.fork({ disableContextResolution: true })
      return loadTriggersForTenant(outsideTransaction, scope.tenantId, scope.organizationId)
    }

    expect(await findTriggers(input)).toEqual([])
    await em.transactional(async (transaction) => {
      expect(await authoring(transaction).createExampleDefinitionIfAbsent(transaction, input)).toBe('created')
      expect(await findTriggers(input)).toEqual([])
    })
    expect(await findTriggers(input)).toMatchObject([{ triggerId: 'example-created', source: 'embedded' }])

    await expect(em.transactional(async (transaction) => {
      expect(await authoring(transaction).createExampleDefinitionIfAbsent(transaction, rolledBack)).toBe('created')
      throw new Error('[internal] Roll back workflow example')
    })).rejects.toThrow('Roll back workflow example')
    expect(await findTriggers(rolledBack)).toEqual([])
  })
})
