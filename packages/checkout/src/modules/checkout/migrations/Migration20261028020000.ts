import { Migration } from '@mikro-orm/migrations';

// Release 5, Step 4.2 (checkout §4.4, "extended, additive"). `checkout_transactions`
// gains three nullable columns (`session_id`/`order_id`/`quote_id`) for the session-backed
// gateway step (§7.2 step 7, `commands/submit.ts`) and `link_id` becomes nullable — a
// buyer-initiated session (no `CheckoutLink`) still needs ONE row per attempt. Every Phase
// A row keeps `link_id` set and the three new columns null; Phase A behaviour is untouched.
export class Migration20261028020000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "checkout_transactions" alter column "link_id" drop not null;`);
    this.addSql(`alter table "checkout_transactions" add column "session_id" uuid null, add column "order_id" uuid null, add column "quote_id" uuid null;`);
    this.addSql(`create index "checkout_transactions_organization_id_tenant_id_se_8f1b2_index" on "checkout_transactions" ("organization_id", "tenant_id", "session_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index if exists "checkout_transactions_organization_id_tenant_id_se_8f1b2_index";`);
    this.addSql(`alter table "checkout_transactions" drop column "session_id", drop column "order_id", drop column "quote_id";`);
    this.addSql(`alter table "checkout_transactions" alter column "link_id" set not null;`);
  }

}
