import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import { resolveIntegrationDatabaseUrl } from '@open-mercato/core/helpers/integration/dbFixtures'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import * as customerEntities from '@open-mercato/core/modules/customers/data/entities'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import handle from '../subscribers/autoLinkCrmReverse'

export const integrationMeta = { dependsOnModules: ['customer_accounts', 'customers'] }

const { CustomerEntity, CustomerPersonProfile } = customerEntities
const schema = `cacc_reverse_${randomUUID().replaceAll('-', '')}`
const tenantDataEncryption = process.env.TENANT_DATA_ENCRYPTION
let orm: MikroORM

async function withFixture(run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>): Promise<void> {
  const fixture = await createFixture()
  try {
    await run(fixture)
  } finally {
    const cleanup = orm.em.fork()
    await cleanup.nativeDelete(CustomerUser, { id: fixture.user.id })
    await cleanup.nativeDelete(CustomerPersonProfile, { id: fixture.profile.id })
    await cleanup.nativeDelete(CustomerEntity, { id: { $in: fixture.entities.map((entity) => entity.id) } })
  }
}

async function createFixture() {
  const em = orm.em.fork()
  const tenantId = randomUUID()
  const organizationId = randomUUID()
  const email = `reverse-${randomUUID()}@example.test`
  const scope = { tenantId, organizationId }
  const company = em.create(CustomerEntity, {
    id: randomUUID(), ...scope, kind: 'company', displayName: 'Reverse company',
  })
  const person = em.create(CustomerEntity, {
    id: randomUUID(), ...scope, kind: 'person', displayName: 'Reverse person', primaryEmail: email,
  })
  const competingCompany = em.create(CustomerEntity, {
    id: randomUUID(), ...scope, kind: 'company', displayName: 'Competing company',
  })
  const competingPerson = em.create(CustomerEntity, {
    id: randomUUID(), ...scope, kind: 'person', displayName: 'Competing person', primaryEmail: email,
  })
  const profile = em.create(CustomerPersonProfile, { id: randomUUID(), ...scope, entity: person, company })
  const user = em.create(CustomerUser, {
    id: randomUUID(), ...scope, email, emailHash: hashForLookup(email), displayName: 'Reverse user',
    failedLoginAttempts: 0, isActive: true, createdAt: new Date(),
    personEntityId: null, customerEntityId: null, deletedAt: null,
  })
  const entities = [company, person, competingCompany, competingPerson]
  em.persist([...entities, profile, user])
  await em.flush()
  return { ...scope, user, person, company, profile, competingCompany, competingPerson, entities }
}

function context(em: EntityManager) {
  return {
    resolve: <T = unknown>(name: string): T => {
      if (name !== 'em') throw new Error('[internal] Unexpected reverse-link dependency')
      return em as unknown as T
    },
  }
}

function beforeFirstWrite(em: EntityManager, beforeWrite: () => Promise<void>) {
  let firstWrite = true
  const affectedRows: number[] = []
  const nativeUpdate: EntityManager['nativeUpdate'] = async (entity, where, updates, options) => {
    if (firstWrite) {
      firstWrite = false
      await beforeWrite()
    }
    const affected = await em.nativeUpdate(entity, where, updates, options)
    affectedRows.push(affected)
    return affected
  }
  const subscriberEm = new Proxy(em, {
    get(target, property) {
      if (property === 'nativeUpdate') return nativeUpdate
      const value = Reflect.get(target, property)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return { em: subscriberEm, affectedRows }
}

async function readLinks(record: CustomerUser) {
  const user = await findOneWithDecryption(orm.em.fork(), CustomerUser, {
    id: record.id, tenantId: record.tenantId, organizationId: record.organizationId,
  })
  expect(user).not.toBeNull()
  return { personEntityId: user?.personEntityId, customerEntityId: user?.customerEntityId }
}

test.describe('TC-CACC-REVERSE-LINK-002: persisted company recovery and competing writes', () => {
  test.beforeAll(async () => {
    process.env.TENANT_DATA_ENCRYPTION = 'off'
    orm = await MikroORM.init({
      clientUrl: resolveIntegrationDatabaseUrl(),
      entities: [CustomerUser, ...Object.values(customerEntities)],
      metadataProvider: ReflectMetadataProvider,
      schema,
      driverOptions: { options: `-c search_path=${schema}` },
    })
    await orm.schema.create()
  })

  test.afterAll(async () => {
    try {
      if (orm) await orm.em.getConnection().execute(`drop schema if exists "${schema}" cascade`)
    } finally {
      try {
        if (orm) await orm.close(true)
      } finally {
        if (tenantDataEncryption === undefined) delete process.env.TENANT_DATA_ENCRYPTION
        else process.env.TENANT_DATA_ENCRYPTION = tenantDataEncryption
      }
    }
  })

  test('hydrates the company relation, persists both links and leaves them unchanged on replay', async () => {
    await withFixture(async (fixture) => {
      const profile = await findOneWithDecryption(orm.em.fork(), CustomerPersonProfile, { id: fixture.profile.id })
      expect(profile?.company?.id).toBe(fixture.company.id)
      const payload = { id: fixture.profile.id, tenantId: fixture.tenantId, organizationId: fixture.organizationId }
      await handle(payload, context(orm.em.fork()))
      const expected = { personEntityId: fixture.person.id, customerEntityId: fixture.company.id }
      expect(await readLinks(fixture.user)).toEqual(expected)
      await handle(payload, context(orm.em.fork()))
      expect(await readLinks(fixture.user)).toEqual(expected)
    })
  })

  for (const invalidScope of ['tenant', 'organization', 'deleted'] as const) {
    test(`does not recover a ${invalidScope} company from its persisted profile`, async () => {
      await withFixture(async (fixture) => {
        const update = invalidScope === 'tenant'
          ? { tenantId: randomUUID() }
          : invalidScope === 'organization'
            ? { organizationId: randomUUID() }
            : { deletedAt: new Date() }
        await orm.em.fork().nativeUpdate(CustomerEntity, { id: fixture.company.id }, update)
        const payload = { id: fixture.person.id, tenantId: fixture.tenantId, organizationId: fixture.organizationId }
        await handle(payload, context(orm.em.fork()))
        expect(await readLinks(fixture.user)).toEqual({ personEntityId: fixture.person.id, customerEntityId: null })
        await handle(payload, context(orm.em.fork()))
        expect(await readLinks(fixture.user)).toEqual({ personEntityId: fixture.person.id, customerEntityId: null })
      })
    })
  }

  for (const competingLink of ['company', 'person'] as const) {
    test(`preserves a committed competing ${competingLink} assignment between lookup and SQL update`, async () => {
      await withFixture(async (fixture) => {
        const competingEm = orm.em.fork()
        const subscriber = beforeFirstWrite(orm.em.fork(), async () => {
          const update = competingLink === 'company'
            ? { customerEntityId: fixture.competingCompany.id }
            : { personEntityId: fixture.competingPerson.id }
          expect(await competingEm.nativeUpdate(CustomerUser, { id: fixture.user.id }, update)).toBe(1)
        })
        const payload = { id: fixture.person.id, tenantId: fixture.tenantId, organizationId: fixture.organizationId }
        await handle(payload, context(subscriber.em))
        expect(subscriber.affectedRows).toEqual([0])
        expect(await readLinks(fixture.user)).toEqual(competingLink === 'company'
          ? { personEntityId: null, customerEntityId: fixture.competingCompany.id }
          : { personEntityId: fixture.competingPerson.id, customerEntityId: null })
        await handle(payload, context(orm.em.fork()))
        const expected = competingLink === 'company'
          ? { personEntityId: fixture.person.id, customerEntityId: fixture.competingCompany.id }
          : { personEntityId: fixture.competingPerson.id, customerEntityId: null }
        expect(await readLinks(fixture.user)).toEqual(expected)
        await handle(payload, context(orm.em.fork()))
        expect(await readLinks(fixture.user)).toEqual(expected)
      })
    })
  }
})
