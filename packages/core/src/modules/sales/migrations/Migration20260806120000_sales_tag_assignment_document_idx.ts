import { Migration } from '@mikro-orm/migrations';

// sales_document_tag_assignments had no index whose leading column is
// document_id: the table carries PK(id), (organization_id, tenant_id) and the
// unique (tag_id, document_id, document_kind) — and the unique index leads with
// tag_id, which a document-scoped predicate never supplies. Every read and
// write that resolves a document's tags therefore degraded to a sequential scan
// as the table grew: syncSalesDocumentTags' per-save delete
// (commands/documents.ts) and the order/quote grid's
// `left join ... on id = document_id` (api/documents/factory.ts) alike. On a
// 2.85M-row / 868MB production table the delete measured 139.9 ms — a full
// table scan to remove the two rows belonging to one order.
//
// document_kind is deliberately omitted. sales_orders.id and sales_quotes.id
// are both gen_random_uuid() from their own tables, so a document_id already
// determines its kind; the second column adds no selectivity for ~30% more
// index and document_kind is simply rechecked over the rows the seek returns.
// The unique (tag_id, document_id, document_kind) index stays as-is — its
// leading tag_id is load-bearing for sales.tags.delete (commands/tags.ts), for
// the grid's tag filter and for the foreign-key check. Both column orders are
// needed; two indexes is correct.
//
// The table is high-churn, so the index is built CONCURRENTLY to avoid blocking
// writes during the build. CREATE INDEX CONCURRENTLY cannot run inside a
// transaction, hence isTransactional() => false; the migration runner applies
// migrations one-by-one, so this opt-out is safe (same pattern as
// Migration20260611103000_query_index). Drop first so retrying a failed
// concurrent build removes PostgreSQL's invalid index stub instead of letting
// IF NOT EXISTS silently accept it: a half-built concurrent index is left
// INVALID, the planner ignores it, and IF NOT EXISTS would report success while
// the table stays unindexed.
//
// On a database that does not have the index yet — every fresh install — the
// drop is a no-op and there is no window without it. An operator who already
// created this index out of band should expect it to be rebuilt here, and the
// document-scoped scans to fall back to their pre-index cost until the
// concurrent build finishes; on a large table, run this while the writers that
// depend on it are paused.
export class Migration20260806120000_sales_tag_assignment_document_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_document_tag_assignments_document_idx";`);
    this.addSql(`create index concurrently "sales_document_tag_assignments_document_idx" on "sales_document_tag_assignments" ("document_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_document_tag_assignments_document_idx";`);
  }

}
