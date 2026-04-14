// TODO(mikro-orm v7): stub for `knex` module used by legacy parts of HybridQueryEngine.
// See packages/shared/src/lib/query/knex-compat.d.ts for the shared counterpart and
// mikroorm_audit.md for the migration plan. Runtime calls to knex-like APIs in this
// module still rely on the shared stub type; a full Kysely rewrite is tracked as
// follow-up in audit stages 3.x.
declare module 'knex' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Knex<_TRecord = any, _TResult = any> = any

  // eslint-disable-next-line @typescript-eslint/no-namespace
  export namespace Knex {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type QueryBuilder<_TRecord = any, _TResult = any> = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type JoinClause = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type Raw<_T = any> = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type Value = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type Transaction = any
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    export type ColumnBuilder = any
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const knex: any
  export default knex
}
