import { Migration } from '@mikro-orm/migrations';
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex';

/**
 * Catch-up reindex for `Migration20260410171544`, which added `position` and `is_default` to
 * `dictionary_entries` and backfilled them in raw SQL. Documents written before that migration
 * were never rebuilt, so `entity_indexes.doc` for `dictionaries:dictionary_entry` is missing both
 * keys entirely rather than holding a stale value — the same absent emit, a different symptom.
 *
 * This migration executes no SQL — the declaration below is its entire payload.
 */
export const queryIndexReindexEntityTypes = declareQueryIndexReindex([
  'dictionaries:dictionary_entry',
]);

export class Migration20260901120000_reindex_dictionary_entries extends Migration {
  override up(): void | Promise<void> {}

  override down(): void | Promise<void> {}
}
