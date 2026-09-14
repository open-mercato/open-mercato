import { Migration } from '@mikro-orm/migrations';

// Postgres's built-in unaccent() is STABLE, not IMMUTABLE, so it cannot be
// used inside an index expression directly. catalog_immutable_unaccent()
// wraps it as IMMUTABLE so it can back the trigram index below, and the
// application query (packages/core/src/modules/catalog/api/products/route.ts,
// PRODUCT_SEARCH_EXPRESSION_SQL) uses the exact same expression so Postgres
// can actually pick the index up.
export class Migration20260914120000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create extension if not exists "unaccent" schema public;`);
    this.addSql(`create extension if not exists "pg_trgm" schema public;`);
    // Schema-qualified on purpose: inside this migration's own transaction,
    // an unqualified unaccent(...) call (or a regdictionary cast) right after
    // "create extension" is not reliably resolvable yet via search_path —
    // verified against Postgres 17 — while the schema-qualified call is.
    this.addSql(`
      create or replace function catalog_immutable_unaccent(text)
      returns text as $$
        select public.unaccent($1)
      $$ language sql immutable parallel safe;
    `);
    this.addSql(`
      create index if not exists "catalog_products_search_trgm_idx"
      on "catalog_products"
      using gin (
        catalog_immutable_unaccent(
          coalesce("title", '') || ' ' || coalesce("subtitle", '') || ' ' || coalesce("description", '') || ' ' || coalesce("sku", '') || ' ' || coalesce("handle", '')
        ) gin_trgm_ops
      );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "catalog_products_search_trgm_idx";`);
    this.addSql(`drop function if exists catalog_immutable_unaccent(text);`);
  }

}
