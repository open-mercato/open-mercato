import { randomUUID } from 'node:crypto'
import { MikroORM, PostgreSqlDriver } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers'
import { commandRegistry, type CommandRuntimeContext, type CommandUndoLogEntry } from '@open-mercato/shared/lib/commands'
import { DefaultDataEngine } from '@open-mercato/shared/lib/data/engine'
import { CustomEntity, CustomFieldDef, CustomFieldValue } from '@open-mercato/core/modules/entities/data/entities'
import * as customerEntities from '../../data/entities'
import '../deals'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const {
  CustomerDeal, CustomerDealPersonLink, CustomerDealCompanyLink, CustomerDealStageTransition,
  CustomerDictionaryEntry, CustomerEntity, CustomerPipeline, CustomerPipelineStage,
} = customerEntities

const entityId = 'customers:customer_deal'
const describePostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describePostgres('standalone deal command transactions', () => {
  let postgres: StartedTestContainer
  let orm: MikroORM<PostgreSqlDriver>
  let ctx: CommandRuntimeContext
  let dataEngine: DefaultDataEngine
  let markChange: jest.SpiedFunction<DefaultDataEngine['markOrmEntityChange']>
  let input: {
    organizationId: string
    tenantId: string
    title: string
    personIds: string[]
    companyIds: string[]
    pipelineStageId: string
    cf_priority: string
  }

  const create = () => commandRegistry.get<unknown, { dealId: string }>('customers.deals.create')!
  const remove = () => commandRegistry.get('customers.deals.delete')!

  beforeAll(async () => {
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'deal_test', POSTGRES_USER: 'deal_test', POSTGRES_PASSWORD: 'deal_test' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
      .start()
    orm = await MikroORM.init({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'deal_test',
      user: 'deal_test',
      password: 'deal_test',
      entities: [...Object.values(customerEntities), CustomEntity, CustomFieldDef, CustomFieldValue],
    })
    await orm.schema.create()
  }, 60000)

  afterAll(async () => {
    await orm?.close(true)
    await postgres?.stop()
  })

  beforeEach(async () => {
    await orm.schema.clear()
    const scope = { organizationId: randomUUID(), tenantId: randomUUID() }
    const em = orm.em.fork()
    const person = em.create(CustomerEntity, { ...scope, kind: 'person', displayName: 'Contact' })
    const company = em.create(CustomerEntity, { ...scope, kind: 'company', displayName: 'Customer' })
    const pipeline = em.create(CustomerPipeline, { ...scope, name: 'Sales pipeline' })
    await em.flush()
    const stage = em.create(CustomerPipelineStage, { ...scope, pipelineId: pipeline.id, label: 'Discovery' })
    em.create(CustomFieldDef, { ...scope, entityId, key: 'priority', kind: 'text' })
    await em.flush()

    const requestEm = orm.em.fork({ useContext: true })
    const container = createContainer()
    dataEngine = new DefaultDataEngine(requestEm, container)
    container.register({
      em: asValue(requestEm),
      dataEngine: asValue(dataEngine),
      cache: asValue(null),
    })
    markChange = jest.spyOn(dataEngine, 'markOrmEntityChange')
    ctx = {
      container,
      auth: { sub: randomUUID(), tenantId: scope.tenantId, orgId: scope.organizationId },
      organizationScope: null,
      selectedOrganizationId: scope.organizationId,
      organizationIds: [scope.organizationId],
    }
    input = {
      ...scope,
      title: 'Renewal',
      personIds: [person.id],
      companyIds: [company.id],
      pipelineStageId: stage.id,
      cf_priority: 'high',
    }
  })

  async function readGraph() {
    const reader = orm.em.fork()
    return {
      deals: await reader.count(CustomerDeal),
      people: await reader.count(CustomerDealPersonLink),
      companies: await reader.count(CustomerDealCompanyLink),
      transitions: await reader.count(CustomerDealStageTransition),
      custom: (await reader.find(CustomFieldValue, { entityId })).map((value) => value.valueText),
    }
  }

  const absent = { deals: 0, people: 0, companies: 0, transitions: 0, custom: [] }
  const present = { deals: 1, people: 1, companies: 1, transitions: 1, custom: ['high'] }

  function failAfterCustomFieldWrite() {
    const write = dataEngine.setCustomFields.bind(dataEngine)
    jest.spyOn(dataEngine, 'setCustomFields').mockImplementationOnce(async (values) => {
      await write(values)
      throw new Error('[internal] injected custom-field failure')
    })
  }

  async function prepareDelete(id: string): Promise<CommandUndoLogEntry> {
    const snapshots = await remove().prepare!({ id }, ctx)
    return {
      id: randomUUID(),
      commandId: 'customers.deals.delete',
      resourceId: id,
      commandPayload: { undo: { before: snapshots?.before } },
    }
  }

  test('rolls back create, including its custom field, stage history, links and dictionary entry', async () => {
    failAfterCustomFieldWrite()

    await expect(create().execute(input, ctx)).rejects.toThrow('injected custom-field failure')

    expect(await readGraph()).toEqual(absent)
    expect(await orm.em.fork().count(CustomerDictionaryEntry)).toBe(0)
    expect(markChange).not.toHaveBeenCalled()
  })

  test.each(['delete', 'create-undo'] as const)('rolls back eager deletes when %s fails on the deal row', async (operation) => {
    const { dealId } = await create().execute(input, ctx)
    expect(await readGraph()).toEqual(present)
    markChange.mockClear()
    const connection = orm.em.getConnection()
    await connection.execute('create table deal_delete_blocker (deal_id uuid references customer_deals (id))')
    await connection.execute('insert into deal_delete_blocker (deal_id) values (?)', [dealId])
    const apply = () => operation === 'delete'
      ? remove().execute({ id: dealId }, ctx)
      : create().undo!({
        input: undefined,
        ctx,
        logEntry: { id: randomUUID(), commandId: 'customers.deals.create', resourceId: dealId },
      })

    try {
      await expect(apply()).rejects.toThrow('deal_delete_blocker')
      expect(await readGraph()).toEqual(present)
      expect(markChange).not.toHaveBeenCalled()
    } finally {
      await connection.execute('drop table deal_delete_blocker')
    }

    let stateAtEffect: ReturnType<typeof readGraph> | undefined
    markChange.mockImplementationOnce(() => { stateAtEffect = readGraph() })
    await apply()
    expect(markChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'deleted' }))
    expect(await stateAtEffect).toEqual(absent)
  })

  test('rolls back delete-undo on custom-field failure and queues effects after a successful retry', async () => {
    const { dealId } = await create().execute(input, ctx)
    const logEntry = await prepareDelete(dealId)
    await remove().execute({ id: dealId }, ctx)
    expect(await readGraph()).toEqual(absent)
    markChange.mockClear()
    failAfterCustomFieldWrite()

    const undo = () => remove().undo!({ input: undefined, ctx, logEntry })
    await expect(undo()).rejects.toThrow('injected custom-field failure')
    expect(await readGraph()).toEqual(absent)
    expect(markChange).not.toHaveBeenCalled()

    let stateAtEffect: ReturnType<typeof readGraph> | undefined
    markChange.mockImplementationOnce(() => { stateAtEffect = readGraph() })
    await undo()
    expect(markChange).toHaveBeenCalledWith(expect.objectContaining({ action: 'created' }))
    expect(await stateAtEffect).toEqual(present)
    expect(await orm.em.fork().findOne(CustomerDeal, dealId)).toMatchObject({ id: dealId, title: input.title })
  })

  test('deletes successfully when the optional stage history table is absent', async () => {
    const { dealId } = await create().execute(input, ctx)
    const connection = orm.em.getConnection()
    await connection.execute('truncate customer_deal_stage_transitions')
    await connection.execute('alter table customer_deal_stage_transitions rename to archived_deal_stage_transitions')
    try {
      await remove().execute({ id: dealId }, ctx)
    } finally {
      await connection.execute('alter table archived_deal_stage_transitions rename to customer_deal_stage_transitions')
    }
    expect(await readGraph()).toEqual(absent)
  })

  test('keeps replay and custom-field cleanup in the deal tenant', async () => {
    const { dealId } = await create().execute(input, ctx)
    const foreignTenant = { tenantId: randomUUID(), organizationId: randomUUID() }
    const foreignCtx: CommandRuntimeContext = {
      ...ctx,
      auth: { sub: randomUUID(), tenantId: foreignTenant.tenantId, orgId: foreignTenant.organizationId },
      selectedOrganizationId: foreignTenant.organizationId,
      organizationIds: [foreignTenant.organizationId],
    }
    markChange.mockClear()
    await create().undo!({
      input: undefined,
      ctx: foreignCtx,
      logEntry: { id: randomUUID(), commandId: 'customers.deals.create', resourceId: dealId },
    })
    expect(await readGraph()).toEqual(present)
    expect(markChange).not.toHaveBeenCalled()

    const em = orm.em.fork()
    em.create(CustomFieldValue, { ...foreignTenant, entityId, recordId: dealId, fieldKey: 'priority', valueText: 'foreign' })
    await em.flush()
    const before = await prepareDelete(dealId)
    await remove().execute({ id: dealId }, ctx)
    markChange.mockClear()
    await expect(remove().undo!({ input: undefined, ctx: foreignCtx, logEntry: before })).rejects.toMatchObject({ status: 403 })
    expect(await readGraph()).toEqual({ ...absent, custom: ['foreign'] })
    expect(markChange).not.toHaveBeenCalled()
  })
})
