import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
} from 'kysely'

export type RecordedRows = (query: CompiledQuery) => Record<string, unknown>[]

export function createRecordingKysely(rowsFor: RecordedRows = () => []) {
  const queries: CompiledQuery[] = []
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createIntrospector: (instance: Kysely<unknown>) => new PostgresIntrospector(instance),
    },
  })
  const executor = db.getExecutor() as unknown as { executeQuery: (query: CompiledQuery) => Promise<unknown> }
  executor.executeQuery = async (query: CompiledQuery) => {
    queries.push(query)
    return { rows: rowsFor(query) }
  }
  return { db, queries }
}

export function isCountQuery(query: CompiledQuery): boolean {
  return query.sql.includes('count(*)')
}
