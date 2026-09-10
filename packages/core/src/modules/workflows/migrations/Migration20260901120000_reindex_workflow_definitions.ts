import { Migration } from '@mikro-orm/migrations';
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex';

/**
 * Catch-up reindex for `Migration20260428102318`, which renamed three seeded
 * `workflow_definitions.workflow_id` values in raw SQL and never notified the query index. On
 * every install that already applied it, `entity_indexes.doc` for `workflows:workflow_definition`
 * still resolves those records by the pre-rename identifier — `checkout_simple_v1` rather than
 * `workflows.checkout-demo`, and so on — which is exactly the identifier the rename removed.
 *
 * This migration executes no SQL — the declaration below is its entire payload.
 */
export const queryIndexReindexEntityTypes = declareQueryIndexReindex([
  'workflows:workflow_definition',
]);

export class Migration20260901120000_reindex_workflow_definitions extends Migration {
  override up(): void | Promise<void> {}

  override down(): void | Promise<void> {}
}
