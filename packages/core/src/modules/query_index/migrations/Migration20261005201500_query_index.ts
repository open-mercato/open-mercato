import { Migration } from '@mikro-orm/migrations';

// GIN expression index serving the storefront assortment predicate (Storefront Public API
// §3.3, D9): `(doc -> 'scope_keys') ?| $n::text[]` on catalog:catalog_product index documents,
// whose `scope_keys` key the catalog contributes through its doc enricher
// (catalog/lib/productScopeKeys.ts).
//
// Ownership: query_index owns the migration (as the spec's §3.3 table assigns it) because it
// owns `entity_indexes`; a catalog migration cannot do it, since modules migrate in
// alphabetical order and on a fresh database catalog's migrations run before query_index
// creates the table. MANUAL DDL: a partial expression index keyed on another module's entity
// type is not modelled on the EntityIndexRow entity, so `.snapshot-open-mercato.json` does not
// record it; `yarn db:generate` diffs entity metadata against the snapshot, so it never emits a
// drop for it (same approach as the Omnibus trigger DDL in catalog's
// Migration20261005150824_catalog).
//
// The expression must be spelled exactly as the query engine emits it
// (`jsonbDocKeyExpression` in @open-mercato/shared/lib/query/overlap emits the key as a
// literal) or PostgreSQL silently falls back to a sequential scan; the catalog
// product-scope-keys-index test pins both sides. Default `jsonb_ops` (not `jsonb_path_ops`),
// because only `jsonb_ops` supports `?|`.
//
// entity_indexes is high-churn, so the index is built CONCURRENTLY, which cannot run inside a
// transaction (isTransactional() => false; the runner applies migrations one-by-one). Drop
// first so retrying an interrupted build removes PostgreSQL's INVALID index stub. Same shape as
// Migration20260731105052_query_index.
export class Migration20261005201500_query_index extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "entity_indexes_catalog_product_scope_keys_gin_idx";`);
    this.addSql(`create index concurrently "entity_indexes_catalog_product_scope_keys_gin_idx" on "entity_indexes" using gin (("doc" -> 'scope_keys')) where "entity_type" = 'catalog:catalog_product';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "entity_indexes_catalog_product_scope_keys_gin_idx";`);
  }

}
