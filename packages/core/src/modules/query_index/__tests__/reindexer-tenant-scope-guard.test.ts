import { registerLoggerExtension, type LoggerExtensionRecord } from '@open-mercato/shared/lib/logger'
import { reindexEntity } from '../lib/reindexer'
import {
  isTenantGlobalEntityType,
  listTenantGlobalEntityTypes,
  registerTenantGlobalEntityTypes,
  resetTenantGlobalEntityTypes,
} from '../lib/tenant-global'

/** Thrown by the stub the moment the reindexer gets PAST the guard. */
class ReachedSweep extends Error {}

/**
 * A kysely-shaped stub that answers the `information_schema.columns` probe and
 * throws for every other table. Two things make it load-bearing:
 *  - `getColumnSet()` swallows exceptions and returns an EMPTY set, which would
 *    make every case look tenant-less and pass vacuously. The negative controls
 *    below, which need `hasTenantCol` to come back true, are what stop that.
 *  - `seen` records every table touched, so a refusal can assert that the source
 *    table was never read and no job row was written.
 */
function createColumnAwareKysely(columns: string[]) {
  const seen: string[] = []
  const chainFor = (table: string): any => {
    const chain: any = new Proxy({}, {
      get(_target, prop: string | symbol) {
        if (prop === 'execute' || prop === 'executeTakeFirst') {
          return async () => {
            if (table !== 'information_schema.columns') throw new ReachedSweep(`reindex reached ${table}`)
            const rows = columns.map((column_name) => ({ column_name }))
            return prop === 'execute' ? rows : rows[0]
          }
        }
        // Kysely builders are not thenables; without this an `await` on the
        // builder itself would try to resolve the proxy.
        if (prop === 'then') return undefined
        return () => chain
      },
    })
    return chain
  }
  const track = (table: any) => {
    seen.push(String(table))
    return chainFor(String(table))
  }
  return { seen, db: { selectFrom: track, deleteFrom: track, insertInto: track, updateTable: track } }
}

function makeEm(columns: string[]) {
  const { db, seen } = createColumnAwareKysely(columns)
  const em: any = {
    getKysely: () => db,
    // Every entity type used below resolves to a table named after it, so the
    // real `resolveRegisteredEntityTableName` is exercised rather than mocked.
    getMetadata: () => ({
      find: (className: string) => ({ tableName: className }),
      getAll: () => [],
    }),
  }
  return { em, seen }
}

const TENANT = '0e40f2bf-a7ab-465c-8040-20abbd8ad398'
/** `user_roles`: a join row with no tenant column and no organization column. */
const TENANT_LESS = ['id', 'user_id', 'role_id', 'created_at', 'deleted_at']
const TENANT_SCOPED = ['id', 'name', 'tenant_id', 'organization_id', 'created_at']

describe('reindexEntity refuses a tenant-scoped sweep it cannot scope', () => {
  let records: LoggerExtensionRecord[]
  let disposeLogger: () => void

  beforeEach(() => {
    records = []
    disposeLogger = registerLoggerExtension({ emit: (record) => { records.push(record) } })
  })

  afterEach(() => {
    disposeLogger()
    resetTenantGlobalEntityTypes()
  })

  it('refuses auth:user_role without touching the table', async () => {
    const { em, seen } = makeEm(TENANT_LESS)

    const result = await reindexEntity(em, {
      entityType: 'auth:user_role',
      tenantId: TENANT,
      organizationId: null,
    })

    expect(result).toEqual({ processed: 0, total: 0, tenantScopes: [], scopes: [] })
    // The refusal happens before anything is read or written: not the source
    // table, and not `entity_index_jobs` / `entity_index_coverage` either, so the
    // indexer panel gains no permanent `base N / indexed 0` gap.
    expect(seen).toEqual(['information_schema.columns'])
    expect(records.map((record) => record.message)).toContain(
      'Refusing tenant-scoped reindex of a table with no tenant_id column',
    )
  })

  it.each([
    'directory:tenant',
    'customers:customer_deal_person_link',
    'messages:message_recipient',
    'customer_accounts:customer_user_role',
  ])('refuses %s for the same reason', async (entityType) => {
    const { em, seen } = makeEm(TENANT_LESS)

    const result = await reindexEntity(em, { entityType, tenantId: TENANT })

    expect(result.processed).toBe(0)
    expect(seen).toEqual(['information_schema.columns'])
  })

  it('refuses an entity type nobody has classified yet', async () => {
    // The whole reason this is a derived rule and not a denylist: a tenant-less
    // entity type that arrives with a later release must fail closed on its own,
    // with nobody having edited a list.
    const { em, seen } = makeEm(TENANT_LESS)

    const result = await reindexEntity(em, {
      entityType: 'some_future_module:some_future_join_row',
      tenantId: TENANT,
    })

    expect(result.processed).toBe(0)
    expect(seen).toEqual(['information_schema.columns'])
  })

  it('still sweeps a platform-wide catalogue every tenant is meant to read', async () => {
    // Positive control, and the reason the fix is not "index everything under
    // NULL". Reaching `entity_index_jobs` means the guard let it through.
    const { em, seen } = makeEm(TENANT_LESS)

    await expect(
      reindexEntity(em, { entityType: 'feature_toggles:feature_toggle', tenantId: TENANT }),
    ).rejects.toBeInstanceOf(ReachedSweep)
    expect(seen).toContain('entity_index_jobs')
  })

  it('still sweeps an entity type a module registered as tenant-global', async () => {
    registerTenantGlobalEntityTypes('billing:plan')
    const { em, seen } = makeEm(TENANT_LESS)

    await expect(
      reindexEntity(em, { entityType: 'billing:plan', tenantId: TENANT }),
    ).rejects.toBeInstanceOf(ReachedSweep)
    expect(seen).toContain('entity_index_jobs')
  })

  it('still sweeps an ordinary tenant-scoped entity', async () => {
    // The control that stops the whole suite passing vacuously: if the
    // `information_schema` stub were broken, `hasTenantCol` would be false here
    // too and this would refuse instead of throwing.
    const { em, seen } = makeEm(TENANT_SCOPED)

    await expect(
      reindexEntity(em, { entityType: 'customers:customer_person_profile', tenantId: TENANT }),
    ).rejects.toBeInstanceOf(ReachedSweep)
    expect(seen).toContain('entity_index_jobs')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('still sweeps a tenant-less table when the tenant scope is %s', async (_label, tenantId) => {
    // Not an oversight. With no non-null tenant the reindexer sets no
    // `scopeOverrides.tenantId`, so rows land under `tenant_id = NULL` —
    // invisible to both readers, but filed under nobody. Nothing crosses a tenant
    // boundary, so there is nothing here to refuse.
    const { em, seen } = makeEm(TENANT_LESS)

    await expect(
      reindexEntity(em, { entityType: 'auth:user_role', tenantId }),
    ).rejects.toBeInstanceOf(ReachedSweep)
    expect(seen).toContain('entity_index_jobs')
  })
})

describe('the tenant-global allowlist', () => {
  afterEach(() => {
    resetTenantGlobalEntityTypes()
  })

  it('admits this package\'s own catalogue and nothing else by default', () => {
    expect(listTenantGlobalEntityTypes()).toEqual(['feature_toggles:feature_toggle'])
  })

  it.each([
    'directory:tenant',
    'directory:organization',
    'auth:user_role',
    'auth:session',
    'messages:message_recipient',
  ])('leaves %s out — every one of these is private data', (entityType) => {
    expect(isTenantGlobalEntityType(entityType)).toBe(false)
  })

  it('accepts registrations from modules this package cannot see', () => {
    expect(isTenantGlobalEntityType('billing:plan')).toBe(false)
    registerTenantGlobalEntityTypes('billing:plan', ' catalog:price_book ')
    expect(isTenantGlobalEntityType('billing:plan')).toBe(true)
    expect(isTenantGlobalEntityType('catalog:price_book')).toBe(true)
  })

  it.each([['', 'empty'], ['   ', 'blank']])('ignores an %s registration (%s)', (entityType) => {
    registerTenantGlobalEntityTypes(entityType)
    expect(listTenantGlobalEntityTypes()).toEqual(['feature_toggles:feature_toggle'])
    expect(isTenantGlobalEntityType(entityType)).toBe(false)
  })
})
