import { Migration } from '@mikro-orm/migrations'
import { declareQueryIndexReindex } from '@open-mercato/shared/lib/query/migration-reindex'

export const queryIndexReindexEntityTypes = declareQueryIndexReindex(['sales:sales_order'])

export class Migration20261126201000_reindex_sales_orders extends Migration {
  override up(): void {}

  override down(): void {}
}
