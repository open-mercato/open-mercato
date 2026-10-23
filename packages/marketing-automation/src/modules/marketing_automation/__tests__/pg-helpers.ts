import 'reflect-metadata'
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy'
import { MikroORM, type EntityManager } from '@mikro-orm/postgresql'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands/types'

/**
 * Shared scaffolding for this package's `.pg.test.ts` suites — a real PostgreSQL, no mocked
 * EntityManager, used for exactly the properties a fake one cannot stage: a conditional UPDATE's
 * atomicity under real concurrent connections, a pessimistic lock serializing two writers, and
 * what a column actually holds on disk.
 *
 * Gated on `OM_MARKETING_AUTOMATION_PG_URL` — a throwaway database, since every suite calls
 * `orm.schema.refresh()`. Never point it at a development or shared database. For example:
 *
 *   docker run -d --rm --name om-marketing-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=om \
 *     -p 54374:5432 postgres:17-alpine
 *   OM_MARKETING_AUTOMATION_PG_URL=postgres://postgres:postgres@127.0.0.1:54374/om \
 *     yarn workspace @open-mercato/marketing-automation jest .pg.test
 */
export const PG_URL = process.env.OM_MARKETING_AUTOMATION_PG_URL ?? ''
export const maybe = PG_URL ? describe : describe.skip

export const TENANT_ID = '11111111-1111-4111-8111-111111111111'
export const ORG_ID = '22222222-2222-4222-8222-222222222222'
export const SCOPE = { tenantId: TENANT_ID, organizationId: ORG_ID }

export async function createPgOrm(entities: Array<new (...args: never[]) => unknown>): Promise<MikroORM> {
  const orm = await MikroORM.init({
    clientUrl: PG_URL,
    entities,
    metadataProvider: ReflectMetadataProvider,
    allowGlobalContext: true,
    debug: false,
    pool: { min: 0, max: 20 },
  } as never)
  await orm.schema.refresh()
  return orm
}

/**
 * A command-handler context backed by the real `orm`, not a mock.
 *
 * `enforceCommandOptimisticLockWithGuards` resolves an optional enterprise guard service by DI key
 * and silently no-ops when the resolved value has no `.enforce` method — an `em.fork()` qualifies,
 * so the same `resolve` can serve both `'em'` and that lookup without a second branch.
 */
export function pgCommandContext(orm: MikroORM, overrides: Partial<CommandRuntimeContext> = {}): CommandRuntimeContext {
  return {
    container: {
      resolve: () => orm.em.fork(),
      hasRegistration: () => false,
    },
    auth: { sub: 'tester', tenantId: TENANT_ID, orgId: ORG_ID, isSuperAdmin: false },
    organizationScope: null,
    selectedOrganizationId: ORG_ID,
    systemActor: false,
    request: null,
    ...overrides,
  } as unknown as CommandRuntimeContext
}

export function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

export function delay(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms))
}

export type { EntityManager }
