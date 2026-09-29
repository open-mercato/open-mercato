import { Migration } from '@mikro-orm/migrations';

export class Migration20260725101500_payment_gateways extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`alter table "gateway_transactions" add column "captured_amount" numeric(18,4) not null default '0';`);
    this.addSql(`alter table "gateway_payment_operations" add column "reserved_amount" numeric(18,4) null;`);
    // Backfill the captured-to-date ledger from the succeeded capture operations, which are the
    // only capture path since the payment operation ledger landed. Transactions captured before
    // that (no succeeded capture rows) fall back to their full amount when their status says the
    // money was taken. A historical `partially_captured` transaction has no recoverable captured
    // amount, so it starts at 0 and can still be over-captured once.
    this.addSql(`update "gateway_transactions" as t set "captured_amount" = coalesce((select sum((o."result"->>'capturedAmount')::numeric) from "gateway_payment_operations" as o where o."transaction_id" = t."id" and o."operation_type" = 'capture' and o."status" = 'succeeded'), case when t."unified_status" in ('captured', 'refunded', 'partially_refunded') then t."amount" else 0 end);`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "gateway_payment_operations" drop column "reserved_amount";`);
    this.addSql(`alter table "gateway_transactions" drop column "captured_amount";`);
  }

}
