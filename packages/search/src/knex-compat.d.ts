/**
 * Knex compatibility types for MikroORM v7 migration
 * v7 removed knex dependency; we use local type aliases so code can reference Knex types
 * Runtime uses em.getKysely() instead of em.getConnection().getKnex()
 */

// eslint-disable-next-line @typescript-eslint/no-namespace
namespace Knex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type QueryBuilder<_TRecord = any, _TResult = any> = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type JoinClause = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Raw<_T = any> = any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Value = any
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Knex = any
