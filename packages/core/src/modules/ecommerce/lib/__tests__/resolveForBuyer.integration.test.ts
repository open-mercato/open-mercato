/** @jest-environment node */
import { randomUUID } from 'node:crypto'
import { MikroORM } from '@mikro-orm/core'
import { PostgreSqlDriver, type EntityManager } from '@mikro-orm/postgresql'
import type { StartedTestContainer } from 'testcontainers'
import * as customerAccountsEntities from '@open-mercato/core/modules/customer_accounts/data/entities'
import * as customersEntities from '@open-mercato/core/modules/customers/data/entities'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity, CustomerPersonProfile } from '@open-mercato/core/modules/customers/data/entities'
import { createStoreContextService, type ResolveForBuyerInput } from '../storeContextService'
import { StorefrontResolutionError } from '../storeContext'

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((em: { findOne: (...args: unknown[]) => unknown }, ...args: unknown[]) => em.findOne(...args.slice(0, 2))),
}))

const describeWithPostgres = process.env.OM_PG_INTEGRATION === '1' ? describe : describe.skip

const DATABASE_NAME = 'ecommerce_resolve_for_buyer_test'
const DATABASE_USER = 'ecommerce_resolve_for_buyer'
const DATABASE_PASSWORD = 'ecommerce_resolve_for_buyer'

type TestOrm = MikroORM<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>

type Scope = { tenantId: string; organizationId: string }

function entityClasses(moduleExports: Record<string, unknown>): Array<new (...args: never[]) => unknown> {
  return Object.values(moduleExports).filter(
    (value): value is new (...args: never[]) => unknown => typeof value === 'function',
  )
}

describeWithPostgres('storeContextService.resolveForBuyer buyer checks against real PostgreSQL', () => {
  let postgres: StartedTestContainer | null = null
  let orm: TestOrm | null = null
  const groupCalls: string[][] = []

  function rootEm(): EntityManager {
    if (!orm) throw new Error('[internal] ORM is not started')
    return orm.em.fork({ clear: true })
  }

  function resolveForBuyer(input: ResolveForBuyerInput) {
    const customerGroupsService = {
      resolveGroups: async ({ customerIds }: { customerIds?: string[] }) => {
        groupCalls.push([...(customerIds ?? [])])
        return { groupIds: [], groups: [] }
      },
      resolveTerms: async () => ({
        priceKindId: null,
        paymentTermsDays: null,
        allowPurchaseOnAccount: false,
        approvalRequiredAbove: null,
        minOrderValue: null,
        sources: {},
      }),
      resolveAssortmentScope: async () => ({ scope: null, sourceGroupIds: [], sourceCustomerOverrideId: null }),
    }
    const services: Record<string, unknown> = { em: rootEm(), customerGroupsService }
    const service = createStoreContextService({ resolve: (name: string) => services[name] } as never)
    if (!service.resolveForBuyer) throw new Error('[internal] resolveForBuyer missing')
    return service.resolveForBuyer(input)
  }

  async function expectBuyerOutOfScope(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(StorefrontResolutionError)
    expect(error).toMatchObject({ status: 403, code: 'buyer_out_of_scope' })
  }

  async function seedEntity(scope: Scope, kind: 'person' | 'company', deletedAt: Date | null = null): Promise<string> {
    const em = rootEm()
    const row = em.create(CustomerEntity, {
      ...scope,
      kind,
      displayName: `${kind} ${randomUUID().slice(0, 8)}`,
      deletedAt,
    } as never)
    await em.flush()
    return (row as CustomerEntity).id
  }

  async function seedPersonProfile(scope: Scope, personId: string, companyId: string | null): Promise<void> {
    const em = rootEm()
    em.create(CustomerPersonProfile, {
      ...scope,
      entity: em.getReference(CustomerEntity, personId),
      company: companyId ? em.getReference(CustomerEntity, companyId) : null,
    } as never)
    await em.flush()
  }

  async function seedUser(scope: Scope, personEntityId: string | null, customerEntityId: string | null): Promise<string> {
    const em = rootEm()
    const row = em.create(CustomerUser, {
      ...scope,
      email: `buyer-${randomUUID()}@example.com`,
      emailHash: randomUUID(),
      displayName: 'Buyer',
      personEntityId,
      customerEntityId,
      isActive: true,
    } as never)
    await em.flush()
    return (row as CustomerUser).id
  }

  function newScope(tenantId = randomUUID()): Scope {
    return { tenantId, organizationId: randomUUID() }
  }

  beforeAll(async () => {
    const { GenericContainer, Wait } = await import('testcontainers')
    postgres = await new GenericContainer('postgres:16')
      .withEnvironment({
        POSTGRES_DB: DATABASE_NAME,
        POSTGRES_USER: DATABASE_USER,
        POSTGRES_PASSWORD: DATABASE_PASSWORD,
      })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start()
    orm = await MikroORM.init<PostgreSqlDriver, EntityManager<PostgreSqlDriver>>({
      driver: PostgreSqlDriver,
      host: postgres.getHost(),
      port: postgres.getMappedPort(5432),
      dbName: DATABASE_NAME,
      user: DATABASE_USER,
      password: DATABASE_PASSWORD,
      entities: [...entityClasses(customersEntities), ...entityClasses(customerAccountsEntities)],
      debug: false,
    })
    await orm.schema.create()
    await orm.em.getConnection().execute(
      'create table catalog_product_variant_prices (id uuid primary key, customer_id uuid null, tenant_id uuid not null, organization_id uuid not null)',
    )
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([orm?.close(true)])
    await Promise.allSettled([postgres?.stop()])
  }, 30_000)

  beforeEach(() => {
    groupCalls.length = 0
  })

  it('refuses a portal user with a matching customerId whose CRM person was soft-deleted', async () => {
    const scope = newScope()
    const personId = await seedEntity(scope, 'person', new Date())
    const userId = await seedUser(scope, personId, null)

    await expectBuyerOutOfScope(resolveForBuyer({ ...scope, customerUserId: userId, customerId: personId }))
    expect(groupCalls).toEqual([])
  })

  it('refuses a portal user with a matching customerId whose CRM person lives in another organization', async () => {
    const scope = newScope()
    const otherOrgPersonId = await seedEntity(newScope(scope.tenantId), 'person')
    const userId = await seedUser(scope, otherOrgPersonId, null)

    await expectBuyerOutOfScope(resolveForBuyer({ ...scope, customerUserId: userId, customerId: otherOrgPersonId }))
  })

  it('resolves a portal user with a matching customerId whose CRM person is live in scope', async () => {
    const scope = newScope()
    const personId = await seedEntity(scope, 'person')
    const userId = await seedUser(scope, personId, null)

    const result = await resolveForBuyer({ ...scope, customerUserId: userId, customerId: personId })

    expect(result.customerUserId).toBe(userId)
    expect(result.customerIds).toEqual([personId])
  })

  it('drops a primary company linked from another organization of the same tenant', async () => {
    const scope = newScope()
    const otherOrgCompanyId = await seedEntity(newScope(scope.tenantId), 'company')
    const personId = await seedEntity(scope, 'person')
    await seedPersonProfile(scope, personId, otherOrgCompanyId)

    const result = await resolveForBuyer({ ...scope, customerId: personId })

    expect(result.customerIds).toEqual([personId])
    expect(groupCalls).toEqual([[personId]])
  })

  it('drops a soft-deleted primary company', async () => {
    const scope = newScope()
    const companyId = await seedEntity(scope, 'company', new Date())
    const personId = await seedEntity(scope, 'person')
    await seedPersonProfile(scope, personId, companyId)

    const result = await resolveForBuyer({ ...scope, customerId: personId })

    expect(result.customerIds).toEqual([personId])
    expect(groupCalls).toEqual([[personId]])
  })

  it('keeps a live in-scope primary company', async () => {
    const scope = newScope()
    const companyId = await seedEntity(scope, 'company')
    const personId = await seedEntity(scope, 'person')
    await seedPersonProfile(scope, personId, companyId)

    const result = await resolveForBuyer({ ...scope, customerId: personId })

    expect(result.customerIds).toEqual([personId, companyId])
    expect(groupCalls).toEqual([[personId, companyId]])
  })
})
