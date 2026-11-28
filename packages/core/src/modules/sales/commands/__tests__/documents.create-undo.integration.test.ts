import { randomUUID } from 'node:crypto'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import type { StartedTestContainer } from 'testcontainers'
import { ActionLog } from '@open-mercato/core/modules/audit_logs/data/entities'
import { ActionLogService } from '@open-mercato/core/modules/audit_logs/services/actionLogService'
import { CommandBus } from '@open-mercato/shared/lib/commands/command-bus'
import * as salesEntities from '../../data/entities'
import { SalesCreditMemo, SalesCreditMemoLine, SalesInvoice, SalesInvoiceLine } from '../../data/entities'
import '../documents'

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

describeWithPostgres('sales document create undo against PostgreSQL', () => {
  let postgres: StartedTestContainer | undefined
  let orm: MikroORM

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({ POSTGRES_DB: 'sales_undo', POSTGRES_USER: 'sales_undo', POSTGRES_PASSWORD: 'sales_undo' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init({
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: 'sales_undo',
      user: 'sales_undo',
      password: 'sales_undo',
      entities: [
        ...Object.values(salesEntities).filter((entity) => typeof entity === 'function'),
        ActionLog,
      ],
    })
    await orm.schema.create()
    await orm.em.getConnection().execute(`
      create table sales_undo_delete_guard (
        invoice_id uuid constraint sales_undo_invoice_guard references sales_invoices(id) on delete restrict,
        credit_memo_id uuid constraint sales_undo_credit_memo_guard references sales_credit_memos(id) on delete restrict
      )
    `)
  }, 120_000)

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      await postgres?.stop()
    }
  })

  it.each(['invoice', 'credit memo'] as const)('preserves the %s and its lines after failure and retries with the same token', async (kind) => {
    const em = orm.em.fork()
    const scope = { organizationId: randomUUID(), tenantId: randomUUID() }
    const actorUserId = randomUUID()
    const documentId = randomUUID()
    const lineId = randomUUID()
    const undoToken = randomUUID()
    const isInvoice = kind === 'invoice'
    const header = isInvoice ? SalesInvoice : SalesCreditMemo
    const line = isInvoice ? SalesInvoiceLine : SalesCreditMemoLine
    const documentFields = { ...scope, id: documentId, currencyCode: 'USD' }
    const lineFields = { ...scope, id: lineId, currencyCode: 'USD', name: 'Service' }
    if (isInvoice) {
      const invoice = em.create(SalesInvoice, { ...documentFields, invoiceNumber: documentId }, { partial: true })
      em.create(SalesInvoiceLine, { ...lineFields, invoice }, { partial: true })
    } else {
      const creditMemo = em.create(SalesCreditMemo, { ...documentFields, creditMemoNumber: documentId }, { partial: true })
      em.create(SalesCreditMemoLine, { ...lineFields, creditMemo }, { partial: true })
    }
    const snapshotKey = isInvoice ? 'invoice' : 'creditMemo'
    const log = em.create(ActionLog, {
      ...scope,
      actorUserId,
      commandId: isInvoice ? 'sales.invoices.create' : 'sales.credit_memos.create',
      undoToken,
      commandPayload: { undo: { after: { [snapshotKey]: { id: documentId } } } },
    }, { partial: true })
    await em.flush()

    const connection = em.getConnection()
    const guardColumn = isInvoice ? 'invoice_id' : 'credit_memo_id'
    await connection.execute(`insert into sales_undo_delete_guard (${guardColumn}) values (?)`, [documentId])
    const bus = new CommandBus()
    const undo = () => {
      const undoEm = orm.em.fork()
      return bus.undo(undoToken, {
        container: createContainer().register({ em: asValue(undoEm), actionLogService: asValue(new ActionLogService(undoEm)) }),
        auth: { sub: actorUserId, tenantId: scope.tenantId, orgId: scope.organizationId },
        organizationScope: null,
        selectedOrganizationId: scope.organizationId,
        organizationIds: [scope.organizationId],
      })
    }
    const readDocument = (reader: EntityManager) => reader.findOne<SalesInvoice | SalesCreditMemo>(header, { id: documentId })
    const readLine = (reader: EntityManager) => reader.findOne<SalesInvoiceLine | SalesCreditMemoLine>(line, { id: lineId })

    try {
      await expect(undo()).rejects.toThrow(isInvoice ? 'sales_undo_invoice_guard' : 'sales_undo_credit_memo_guard')
      const afterFailure = orm.em.fork()
      expect(await readDocument(afterFailure)).toMatchObject({ id: documentId })
      expect(await readLine(afterFailure)).toMatchObject({ id: lineId, name: lineFields.name })
      expect(await afterFailure.findOne(ActionLog, { id: log.id })).toMatchObject({ executionState: 'done', undoToken })
    } finally {
      await connection.execute(`delete from sales_undo_delete_guard where ${guardColumn} = ?`, [documentId])
    }

    await expect(undo()).resolves.toBeUndefined()
    const afterRetry = orm.em.fork()
    expect(await readDocument(afterRetry)).toBeNull()
    expect(await readLine(afterRetry)).toBeNull()
    expect(await afterRetry.findOne(ActionLog, { id: log.id })).toMatchObject({ executionState: 'undone', undoToken: null })
  })
})
