import { Migration } from '@mikro-orm/migrations';

export class Migration20261026144220_customer_groups extends Migration {

  override name = 'Migration20261026144220';

  override up(): void | Promise<void> {
    this.addSql(`create table "customer_credit_accounts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "customer_id" uuid not null, "currency_code" text not null, "credit_limit" numeric(16,2) not null, "is_on_hold" boolean not null default false, "hold_reason" text null, "updated_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "customer_credit_accounts_tenant_org_customer_currency_unique" on "customer_credit_accounts" ("tenant_id", "organization_id", "customer_id", "currency_code") where "deleted_at" is null;`);
    this.addSql(`create index "customer_credit_accounts_customer_idx" on "customer_credit_accounts" ("tenant_id", "customer_id");`);
    this.addSql(`create index "customer_credit_accounts_tenant_idx" on "customer_credit_accounts" ("tenant_id");`);

    this.addSql(`create table "customer_credit_ledger_entries" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "credit_account_id" uuid not null, "entry_type" text not null, "amount" numeric(16,2) not null, "source_type" text not null, "source_id" uuid null, "related_entry_id" uuid null, "linked_order_id" uuid null, "idempotency_key" text not null, "balance_after" numeric(16,2) not null, "created_by_actor_type" text not null, "created_by_user_id" uuid null, "note" text null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "customer_credit_ledger_entries_linked_order_idx" on "customer_credit_ledger_entries" ("tenant_id", "linked_order_id");`);
    this.addSql(`create index "customer_credit_ledger_entries_related_entry_idx" on "customer_credit_ledger_entries" ("tenant_id", "related_entry_id");`);
    this.addSql(`create index "customer_credit_ledger_entries_account_created_idx" on "customer_credit_ledger_entries" ("tenant_id", "credit_account_id", "created_at");`);
    this.addSql(`alter table "customer_credit_ledger_entries" add constraint "customer_credit_ledger_entries_tenant_idempotency_unique" unique ("tenant_id", "idempotency_key");`);

    this.addSql(`alter table "customer_group_terms" add "terms_currency_code" text null, add "approval_policy" text null, add "allow_quote_requests" boolean null, add "requires_po_number" boolean null;`);

    this.addSql(`alter table "customer_credit_ledger_entries" add constraint "customer_credit_ledger_entries_credit_account_id_foreign" foreign key ("credit_account_id") references "customer_credit_accounts" ("id") on delete restrict;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "customer_credit_ledger_entries" drop constraint if exists "customer_credit_ledger_entries_credit_account_id_foreign";`);

    this.addSql(`alter table "customer_group_terms" drop column "terms_currency_code", drop column "approval_policy", drop column "allow_quote_requests", drop column "requires_po_number";`);
  }

}
