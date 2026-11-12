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

export type RecordedQuery = { sql: string; parameters: readonly unknown[] }

export type FakeKysely = {
  db: Kysely<any>
  queries: RecordedQuery[]
}

export function createFakeKysely(
  respond: (query: RecordedQuery) => Array<Record<string, unknown>>,
): FakeKysely {
  const queries: RecordedQuery[] = []
  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const recorded = { sql: compiled.sql, parameters: compiled.parameters }
      queries.push(recorded)
      return { rows: respond(recorded) as R[] }
    },
    async *streamQuery() {
      throw new Error('[internal] streaming is not supported by the fake Kysely driver')
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
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (instance) => new PostgresIntrospector(instance),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
  return { db, queries }
}
