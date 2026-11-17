import { Migration } from '@mikro-orm/migrations';
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex';

/**
 * Catch-up reindex for `Migration20260519120000_pipeline_stage_color_tones`, which rewrote
 * `customer_dictionary_entries.color` in raw SQL and never notified the query index. On every
 * install that already applied it, `entity_indexes.doc` for `customers:customer_dictionary_entry`
 * still holds the legacy hex chip (`#facc15`, `#a855f7`, …) instead of the semantic tone, and so
 * do the `search_tokens` rows derived from that document. Both migrations are forward-only, so a
 * follow-up migration is the only route to repair existing installs.
 *
 * This migration executes no SQL — the declaration below is its entire payload.
 */
export const queryIndexReindexEntityTypes = declareQueryIndexReindex([
  'customers:customer_dictionary_entry',
]);

export class Migration20260901120000_reindex_pipeline_stage_colors extends Migration {
  override up(): void | Promise<void> {}

  override down(): void | Promise<void> {}
}
