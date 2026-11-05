import { Migration } from '@mikro-orm/migrations';

// sales_notes and sales_document_addresses each carried a single index —
// (organization_id, tenant_id) — and are never read by that predicate alone.
// loadOrderSnapshot / loadQuoteSnapshot (commands/documents.ts) read them by
// context in the same Promise.all:
//
//   findWithDecryption(em, SalesNote, { contextType, contextId, ...scope })
//   findWithDecryption(em, SalesDocumentAddress, { documentId, documentKind, ...scope })
//
// On a single-organization deployment the scope index matches every row, so the
// planner discards it and scans. The cost is CPU filtering, so a warm cache does
// not reduce it. Measured on a table of ~331k rows / 110 MB: a parallel
// sequential scan removing 110,457 rows per worker, 82 ms per read to return 0
// rows. The command bus runs prepare() and captureAfter() around every command
// and both load a document snapshot, so one written document — itself several
// commands (the document, one per changed line, the payment reconcile) —
// performs roughly 20 of these reads. Counters over one bulk-import batch of 100
// records showed 1,971 sequential scans reading 217,670,528 rows, 2.18M rows per
// imported record; repeatable across consecutive batches (1,971 / 1,974 / 1,911).
//
// context_type and document_kind are deliberately omitted, as they were for
// sales_document_tag_assignments_document_idx (Migration20260806120000), and the
// scope columns with them. sales_orders.id and sales_quotes.id are both
// gen_random_uuid() from their own tables, so a context_id already determines its
// context_type and its tenant; the seek returns the handful of rows belonging to
// one document and the remaining terms are rechecked over those. Folding three
// more columns in — one text and two uuids — roughly triples the index entry for
// no selectivity, on tables that take a write per document save and a note per
// order status change. The sibling scope indexes that do fold scope in
// (sales_order_lines_scope_idx, sales_payments_scope_idx) predate that reasoning.
//
// order_id and quote_id are separate indexes rather than a widening of the above:
// both tables are the child side of `on delete set null` constraints, which
// PostgreSQL does not index automatically, and the constraint check probes
// order_id / quote_id — columns the context index cannot serve even though they
// hold the same uuid. Without them every delete of a parent order or quote scans
// the child table in full.
//
// Both tables are high-churn, so the indexes are built CONCURRENTLY to avoid
// blocking writes during the build. CREATE INDEX CONCURRENTLY cannot run inside a
// transaction, hence isTransactional() => false; the migration runner applies
// migrations one-by-one, so this opt-out is safe. Drop first so retrying a failed
// concurrent build removes PostgreSQL's invalid index stub instead of letting IF
// NOT EXISTS silently accept it: a half-built concurrent index is left INVALID,
// the planner ignores it, and IF NOT EXISTS would report success while the table
// stays unindexed. Same shape as Migration20260806120000 and
// Migration20260731105052_query_index.
//
// On a database that does not have these indexes yet — every fresh install — the
// drops are no-ops and there is no window without them. An operator who already
// created one out of band should expect it to be rebuilt here, and the reads that
// depend on it to fall back to their pre-index cost until the concurrent build
// finishes; on a large table, run this while the writers that depend on it are
// paused.
export class Migration20260821120000_sales_notes_addresses_context_idx extends Migration {

  override isTransactional(): boolean {
    return false;
  }

  override up(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_notes_context_idx";`);
    this.addSql(`create index concurrently "sales_notes_context_idx" on "sales_notes" ("context_id");`);
    this.addSql(`drop index concurrently if exists "sales_notes_order_idx";`);
    this.addSql(`create index concurrently "sales_notes_order_idx" on "sales_notes" ("order_id");`);
    this.addSql(`drop index concurrently if exists "sales_notes_quote_idx";`);
    this.addSql(`create index concurrently "sales_notes_quote_idx" on "sales_notes" ("quote_id");`);

    this.addSql(`drop index concurrently if exists "sales_document_addresses_document_idx";`);
    this.addSql(`create index concurrently "sales_document_addresses_document_idx" on "sales_document_addresses" ("document_id");`);
    this.addSql(`drop index concurrently if exists "sales_document_addresses_order_idx";`);
    this.addSql(`create index concurrently "sales_document_addresses_order_idx" on "sales_document_addresses" ("order_id");`);
    this.addSql(`drop index concurrently if exists "sales_document_addresses_quote_idx";`);
    this.addSql(`create index concurrently "sales_document_addresses_quote_idx" on "sales_document_addresses" ("quote_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index concurrently if exists "sales_document_addresses_quote_idx";`);
    this.addSql(`drop index concurrently if exists "sales_document_addresses_order_idx";`);
    this.addSql(`drop index concurrently if exists "sales_document_addresses_document_idx";`);
    this.addSql(`drop index concurrently if exists "sales_notes_quote_idx";`);
    this.addSql(`drop index concurrently if exists "sales_notes_order_idx";`);
    this.addSql(`drop index concurrently if exists "sales_notes_context_idx";`);
  }

}
