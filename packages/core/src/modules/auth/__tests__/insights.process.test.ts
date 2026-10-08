import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { ProcessActorDimensionContext } from '@open-mercato/shared/modules/insights/process'

jest.mock('@open-mercato/shared/lib/logger', () => {
  const actual = jest.requireActual('@open-mercato/shared/lib/logger')
  const silentLogger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: () => silentLogger,
  }
  return { ...actual, createLogger: () => silentLogger }
})

import { buildProcessRegistrySnapshot } from '@open-mercato/core/modules/insights/lib/process/registry'
import processConfig, { resolveActorRoles } from '../insights.process'
import { defaultEncryptionMaps } from '../encryption'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const USER_A = '33333333-3333-4333-8333-333333333333'
const USER_B = '44444444-4444-4444-8444-444444444444'
const USER_C = '55555555-5555-4555-8555-555555555555'
const ROLE_ADMIN = '66666666-6666-4666-8666-666666666666'
const ROLE_SALES = '77777777-7777-4777-8777-777777777777'

type RecordingDb = {
  db: Kysely<Record<string, never>>
  queries: CompiledQuery[]
  setRows: (rows: Record<string, unknown>[]) => void
}

function createRecordingDb(): RecordingDb {
  const queries: CompiledQuery[] = []
  let rows: Record<string, unknown>[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiledQuery: CompiledQuery): Promise<QueryResult<R>> {
      queries.push(compiledQuery)
      if (/^\s*select/i.test(compiledQuery.sql)) return { rows: rows as R[] }
      return { rows: [] }
    },
    async *streamQuery() {
      throw new Error('[internal] streamQuery is not supported in tests')
    },
  }
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {},
    async commitTransaction() {},
    async rollbackTransaction() {},
    async releaseConnection() {},
    async destroy() {},
  }
  const db = new Kysely<Record<string, never>>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (innerDb) => new PostgresIntrospector(innerDb),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return {
    db,
    queries,
    setRows: (next) => { rows = next },
  }
}

function buildContext(recording: RecordingDb): ProcessActorDimensionContext {
  const em = { getKysely: () => recording.db } as unknown as EntityManager
  return { em, tenantId: TENANT_ID, organizationId: ORG_ID }
}

const EXPECTED_SQL = [
  'select "user_roles"."user_id", "user_roles"."role_id" from "user_roles"',
  'inner join "roles" on "roles"."id" = "user_roles"."role_id"',
  'inner join "users" on "users"."id" = "user_roles"."user_id"',
  'where "user_roles"."user_id" in ($1, $2)',
  'and "user_roles"."deleted_at" is null',
  'and "roles"."deleted_at" is null',
  'and "roles"."tenant_id" = $3',
  'and "users"."deleted_at" is null',
  'and "users"."tenant_id" = $4',
].join(' ')

describe('auth insights.process', () => {
  describe('config shape', () => {
    it('declares version 1 with the role actor dimension and no processes', () => {
      expect(processConfig.version).toBe(1)
      expect(processConfig.processes).toBeUndefined()
      expect(processConfig.actorDimensions).toEqual([{ kind: 'role', resolve: resolveActorRoles }])
    })

    it('registers the role provider against the real auth encryption maps', () => {
      const snapshot = buildProcessRegistrySnapshot(
        [{ moduleId: 'auth', config: processConfig }],
        [{ moduleId: 'auth', maps: defaultEncryptionMaps }],
      )
      expect(snapshot.rejected).toEqual([])
      expect(snapshot.processes).toEqual([])
      expect(Array.from(snapshot.actorDimensions.keys())).toEqual(['role'])
      expect(snapshot.actorDimensions.get('role')).toEqual({
        moduleId: 'auth',
        provider: { kind: 'role', resolve: resolveActorRoles },
      })
    })
  })

  describe('resolveActorRoles', () => {
    it('joins live role assignments to live roles and users of the tenant in one query', async () => {
      const recording = createRecordingDb()

      await resolveActorRoles(buildContext(recording), [USER_A, 'not-a-uuid', USER_B, USER_A, ''])

      expect(recording.queries).toHaveLength(1)
      const [query] = recording.queries
      expect(query.sql).toBe(EXPECTED_SQL)
      expect(query.parameters).toEqual([USER_A, USER_B, TENANT_ID, TENANT_ID])
      expect(query.parameters).not.toContain(ORG_ID)
    })

    it('groups role ids per user, deduplicated', async () => {
      const recording = createRecordingDb()
      recording.setRows([
        { user_id: USER_A, role_id: ROLE_ADMIN },
        { user_id: USER_A, role_id: ROLE_SALES },
        { user_id: USER_A, role_id: ROLE_ADMIN },
        { user_id: USER_B, role_id: ROLE_SALES },
      ])

      const roles = await resolveActorRoles(buildContext(recording), [USER_A, USER_B, USER_C])

      expect(roles).toEqual({
        [USER_A]: [ROLE_ADMIN, ROLE_SALES],
        [USER_B]: [ROLE_SALES],
      })
      expect(Object.prototype.hasOwnProperty.call(roles, USER_C)).toBe(false)
    })

    it('returns an empty map without querying when no actor id is a UUID', async () => {
      const recording = createRecordingDb()
      const getKysely = jest.fn(() => recording.db)
      const ctx: ProcessActorDimensionContext = {
        em: { getKysely } as unknown as EntityManager,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }

      await expect(resolveActorRoles(ctx, [])).resolves.toEqual({})
      await expect(resolveActorRoles(ctx, ['user-1', '', 'api-key:42'])).resolves.toEqual({})

      expect(getKysely).not.toHaveBeenCalled()
      expect(recording.queries).toHaveLength(0)
    })

    it('is the resolver the registry hands to the projection', async () => {
      const recording = createRecordingDb()
      recording.setRows([{ user_id: USER_C, role_id: ROLE_ADMIN }])
      const snapshot = buildProcessRegistrySnapshot([{ moduleId: 'auth', config: processConfig }], [])
      const provider = snapshot.actorDimensions.get('role')?.provider
      if (!provider) throw new Error('[internal] role provider was not registered')

      await expect(provider.resolve(buildContext(recording), [USER_C])).resolves.toEqual({ [USER_C]: [ROLE_ADMIN] })
      expect(recording.queries[0].parameters).toEqual([USER_C, TENANT_ID, TENANT_ID])
    })
  })
})
