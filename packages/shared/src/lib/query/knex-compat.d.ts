// TODO(mikro-orm v7): stub for `knex` module. MikroORM v7 replaced Knex with Kysely and the `knex`
// package is no longer transitively available. This ambient declaration keeps legacy typecheck
// green for modules that still call the knex QueryBuilder (BasicQueryEngine, HybridQueryEngine,
// and misc workers). Full runtime migration to `em.getKysely()` is tracked by `mikroorm_audit.md`
// stages 3–5.
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
