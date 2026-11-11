import { Migration } from '@mikro-orm/migrations';

// #8268 review finding 3: `repair-gateway-payments` selects only outstanding work instead of
// scanning past already-recorded rows. Two nullable columns, no backfill: a pre-existing row
// starts NULL, is re-verified once (a no-op through `findRecordedGatewayPayment`) and is then
// marked. The partial index holds only the outstanding rows the worker selects, in the order
// it selects them.
export class Migration20261111174229_checkout_payment_repair_outstanding extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "checkout_transactions" add column if not exists "payment_recorded_at" timestamptz null, add column if not exists "payment_repair_attempted_at" timestamptz null;`);
    this.addSql(`create index if not exists "checkout_transactions_payment_repair_outstanding_index" on "checkout_transactions" ("tenant_id", "organization_id", "payment_repair_attempted_at" nulls first, "updated_at", "id") where payment_recorded_at is null and status = 'completed' and session_id is not null and order_id is not null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop index if exists "checkout_transactions_payment_repair_outstanding_index";`);
    this.addSql(`alter table "checkout_transactions" drop column if exists "payment_recorded_at", drop column if exists "payment_repair_attempted_at";`);
  }

}
