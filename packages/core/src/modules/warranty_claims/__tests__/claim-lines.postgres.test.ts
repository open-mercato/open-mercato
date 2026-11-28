import { randomUUID } from 'node:crypto'
import { MikroORM, SchemaGenerator } from '@mikro-orm/postgresql'
import { Client } from 'pg'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import * as entities from '../data/entities'
import { WarrantyClaim, WarrantyClaimEvent, WarrantyClaimLine } from '../data/entities'
import { deleteClaimLineCommand, setClaimLineAssessmentCommand, updateClaimLineCommand } from '../commands/claim-lines'

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (key: string, fallback?: string) => fallback ?? key }),
}))

const clientUrl = process.env.OM_WARRANTY_CLAIM_PG_URL
const postgresDescribe = clientUrl ? describe : describe.skip
const scope = { tenantId: randomUUID(), organizationId: randomUUID() }
const schema = `wc_arbitration_${randomUUID().replaceAll('-', '')}`
const versionHeader = 'x-om-ext-optimistic-lock-expected-updated-at'
type Operation = 'update' | 'delete' | 'assessment'
type Outcome = { status: number; body?: Record<string, unknown> }

postgresDescribe('actual claim line commands against disposable PostgreSQL', () => {
  let orm: MikroORM
  let observer: Client
  const previousLockSetting = process.env.OM_OPTIMISTIC_LOCK

  beforeAll(async () => {
    if (!clientUrl) throw new Error('[internal] Disposable PostgreSQL URL is required')
    const target = new URL(clientUrl)
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
      throw new Error('[internal] PostgreSQL regression requires an explicit loopback disposable database')
    }
    process.env.OM_OPTIMISTIC_LOCK = 'all'
    observer = new Client({ connectionString: clientUrl, statement_timeout: 10000 })
    await observer.connect()
    orm = await MikroORM.init({
      clientUrl,
      schema,
      entities: Object.values(entities),
      extensions: [SchemaGenerator],
      pool: { min: 0, max: 8 },
      driverOptions: { statement_timeout: 10000, lock_timeout: 10000, connectionTimeoutMillis: 5000, options: `-c search_path=${schema}` },
    })
    await orm.schema.create()
  })

  afterAll(async () => {
    try {
      await orm?.close(true)
    } finally {
      if (observer) {
        try {
          await observer.query(`drop schema if exists "${schema}" cascade`)
          expect((await observer.query('select 1 from pg_namespace where nspname = $1', [schema])).rowCount).toBe(0)
        } finally {
          await observer.end()
        }
      }
      if (previousLockSetting === undefined) delete process.env.OM_OPTIMISTIC_LOCK
      else process.env.OM_OPTIMISTIC_LOCK = previousLockSetting
    }
  })

  async function fixture() {
    const em = orm.em.fork()
    const claim = em.create(WarrantyClaim, {
      ...scope, id: randomUUID(), claimNumber: randomUUID(), claimType: 'warranty', status: 'received',
      channel: 'staff', priority: 'normal', advanceReplacement: false,
      vendorRef: 'Unrelated vendor reference', totalClaimedAmount: '9', totalApprovedAmount: '9',
    })
    const line = em.create(WarrantyClaimLine, {
      ...scope, id: randomUUID(), claim, lineNo: 1, qtyClaimed: '1', qtyApproved: '1', qtyReceived: '0',
      warrantyStatus: 'unknown', lineStatus: 'pending',
      productName: 'Original product', inspectionNotes: 'Unrelated inspection', creditAmount: '9',
      updatedAt: new Date('2026-07-01T00:00:00.000Z'),
    })
    em.persist([claim, line])
    await em.flush()
    await em.refresh(line)
    return { claim, line }
  }

  function context(version: string, requestScope = scope) {
    const changes: unknown[] = []
    const dataEngine = { markOrmEntityChange: (change: unknown) => changes.push(change) }
    const ctx = {
      container: {
        resolve: (key: string) => {
          if (key === 'em') return orm.em
          if (key === 'dataEngine') return dataEngine
          throw new Error(`[internal] Unregistered optional regression dependency ${key}`)
        },
      },
      auth: { tenantId: requestScope.tenantId, orgId: requestScope.organizationId, sub: randomUUID(), isSuperAdmin: true },
      selectedOrganizationId: requestScope.organizationId,
      organizationIds: [requestScope.organizationId],
      organizationScope: null,
      request: new Request('http://localhost/api/warranty_claims/lines', { headers: { [versionHeader]: version } }),
    } as unknown as CommandRuntimeContext
    return { ctx, changes }
  }

  async function execute(operation: Operation, lineId: string, contender: number, ctx: CommandRuntimeContext): Promise<Outcome> {
    try {
      const input = { id: lineId, ...scope }
      if (operation === 'update') await updateClaimLineCommand.execute({ ...input, productName: `Contender ${contender}` }, ctx)
      else if (operation === 'delete') await deleteClaimLineCommand.execute(input, ctx)
      else await setClaimLineAssessmentCommand.execute({ ...input, assessmentPayload: { contender } }, ctx)
      return { status: 200 }
    } catch (error) {
      if (!(error instanceof CrudHttpError)) throw error
      return { status: error.status, body: error.body as Record<string, unknown> }
    }
  }

  async function waitForBlocked(ownerPid: number, count: number) {
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const result = await observer.query<{ count: string }>(
        `with recursive waiting(pid) as (
           select pid from pg_stat_activity where $1 = any(pg_blocking_pids(pid))
           union
           select activity.pid from pg_stat_activity activity
           join waiting on waiting.pid = any(pg_blocking_pids(activity.pid))
         ) select count(*)::text as count from waiting`, [ownerPid],
      )
      if (Number(result.rows[0]?.count) === count) return
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    throw new Error(`[internal] Expected ${count} actual PostgreSQL lock waiters`)
  }

  async function heldParent(claimId: string) {
    const lock = new Client({ connectionString: clientUrl, statement_timeout: 10000 })
    await lock.connect()
    await lock.query('begin')
    const owner = await lock.query<{ pid: number }>('select pg_backend_pid() as pid')
    await lock.query(`select id from "${schema}".warranty_claims where id=$1 and tenant_id=$2 and organization_id=$3 for update`,
      [claimId, scope.tenantId, scope.organizationId])
    return { lock, pid: owner.rows[0].pid }
  }

  test.each<[Operation, Operation]>([['update', 'update'], ['update', 'delete'], ['assessment', 'assessment']])(
    '%s/%s same-version contenders commit once, reject the loser, and allow a refreshed retry', async (first, second) => {
      const { claim, line } = await fixture()
      const contenders = [context(line.updatedAt.toISOString()), context(line.updatedAt.toISOString())]
      const { lock, pid } = await heldParent(claim.id)
      const pending: Array<Promise<Outcome>> = []
      try {
        pending.push(execute(first, line.id, 0, contenders[0].ctx))
        await waitForBlocked(pid, 1)
        pending.push(execute(second, line.id, 1, contenders[1].ctx))
        await waitForBlocked(pid, 2)
      } finally {
        await lock.query('rollback')
        await lock.end()
        await Promise.allSettled(pending)
      }
      const outcomes = await Promise.all(pending)
      expect(outcomes.map((outcome) => outcome.status)).toEqual([200, 409])
      expect(outcomes[1].body).toMatchObject({ code: 'optimistic_lock_conflict' })
      expect(contenders[0].changes).toHaveLength(2)
      expect(contenders[1].changes).toHaveLength(0)
      const stored = await orm.em.fork().findOneOrFail(WarrantyClaimLine, { id: line.id, ...scope })
      expect(stored.deletedAt).toBeNull()
      expect(stored.creditAmount).toBe('9')
      expect(stored.inspectionNotes).toBe('Unrelated inspection')
      expect(stored.qtyClaimed).toBe(line.qtyClaimed)
      if (first === 'update') expect(stored.productName).toBe('Contender 0')
      else expect(stored.assessmentPayload).toEqual({ contender: 0 })
      expect(await orm.em.fork().count(WarrantyClaimEvent, { claim: claim.id, ...scope })).toBe(first === 'assessment' ? 1 : 0)
      const storedClaim = await orm.em.fork().findOneOrFail(WarrantyClaim, { id: claim.id, ...scope })
      expect(storedClaim.vendorRef).toBe(claim.vendorRef)
      expect(storedClaim.totalClaimedAmount).toBe('9')
      const retry = context(stored.updatedAt.toISOString())
      expect(await execute(second, line.id, 1, retry.ctx)).toEqual({ status: 200 })
      expect(retry.changes).toHaveLength(2)
      const retried = await orm.em.fork().findOneOrFail(WarrantyClaimLine, { id: line.id, ...scope })
      expect(retried.inspectionNotes).toBe('Unrelated inspection')
      expect(retried.creditAmount).toBe('9')
      if (second === 'delete') {
        expect(retried.deletedAt).toBeInstanceOf(Date)
        expect((await orm.em.fork().findOneOrFail(WarrantyClaim, { id: claim.id, ...scope })).totalClaimedAmount).toBe('0')
      } else if (second === 'update') expect(retried.productName).toBe('Contender 1')
      else expect(retried.assessmentPayload).toEqual({ contender: 1 })
      expect(await orm.em.fork().count(WarrantyClaimEvent, { claim: claim.id, ...scope })).toBe(first === 'assessment' ? 2 : 0)
    },
  )

  test.each<Operation>(['update', 'delete', 'assessment'])('%s refuses a parent closed while waiting with no writes or effects', async (operation) => {
    const { claim, line } = await fixture()
    const contender = context(line.updatedAt.toISOString())
    const { lock, pid } = await heldParent(claim.id)
    let pending: Promise<Outcome> | undefined
    try {
      pending = execute(operation, line.id, 0, contender.ctx)
      await waitForBlocked(pid, 1)
      await lock.query(`update "${schema}".warranty_claims set status='closed' where id=$1`, [claim.id])
      await lock.query('commit')
    } finally {
      await lock.query('rollback')
      await lock.end()
      await pending
    }
    expect(await pending).toMatchObject({ status: 400 })
    const stored = await orm.em.fork().findOneOrFail(WarrantyClaimLine, { id: line.id, ...scope })
    expect(stored.updatedAt.toISOString()).toBe(line.updatedAt.toISOString())
    expect(stored.productName).toBe(line.productName)
    expect(stored.assessmentPayload).toBeNull()
    expect(stored.deletedAt).toBeNull()
    expect(contender.changes).toHaveLength(0)
    expect(await orm.em.fork().count(WarrantyClaimEvent, { claim: claim.id, ...scope })).toBe(0)
  })
})
