import { Migration } from '@mikro-orm/migrations';
import {
  IMMUTABLE_UNACCENT_FUNCTION,
  buildImmutableUnaccentFunctionSql,
} from '@open-mercato/shared/lib/db/accentInsensitiveSearch';
import { PRODUCT_SEARCH_EXPRESSION_SQL } from '../lib/productSearch';

export const CATALOG_PRODUCT_SEARCH_INDEX = 'catalog_products_search_trgm_idx';

// Accent-insensitive product search (#6074). The wrapper function and the GIN
// trigram index are built from the same expression builder the query uses
// (lib/productSearch.ts), because PostgreSQL only uses an expression index when
// the predicate is spelled identically — a drift here degrades silently to a
// sequential scan rather than failing.
//
// The extensions come from Migration20260914120000, already committed by the
// time this runs, so the function body can pin the dictionary with
// `'public.unaccent'::regdictionary` instead of resolving it through search_path.
//
// catalog_products is high-churn and this index covers the concatenation of five
// text columns including the full description, so the build is slow enough that
// a plain CREATE INDEX would hold its SHARE lock — blocking every product write
// — for the length of a deploy. It is therefore built CONCURRENTLY, which cannot
// run inside a transaction, hence isTransactional() => false; the migration
// runner applies migrations one-by-one, so this opt-out is safe. Drop first so
// retrying an interrupted concurrent build removes PostgreSQL's INVALID index
// stub instead of letting IF NOT EXISTS report success over an unusable index.
// Same shape as sales/Migration20260821120000 and
// query_index/Migration20260731105052.
export class Migration20260914120100 extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override async up(): Promise<void> {
    this.addSql(buildImmutableUnaccentFunctionSql());
    this.addSql(`drop index concurrently if exists "${CATALOG_PRODUCT_SEARCH_INDEX}";`);
    this.addSql(
      `create index concurrently "${CATALOG_PRODUCT_SEARCH_INDEX}" on "catalog_products" using gin (${PRODUCT_SEARCH_EXPRESSION_SQL} gin_trgm_ops);`,
    );
  }

  override async down(): Promise<void> {
    // The index depends on the function, so it must go first.
    this.addSql(`drop index concurrently if exists "${CATALOG_PRODUCT_SEARCH_INDEX}";`);
    this.addSql(`drop function if exists ${IMMUTABLE_UNACCENT_FUNCTION}(text);`);
  }

}
