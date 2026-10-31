import { Migration } from '@mikro-orm/migrations';

export class Migration20261026120000_sales_recurring_orders extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sales_quote_recurrences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "quote_id" uuid not null, "frequency" text not null, "starts_on" date not null, "anchor_day" int null, "period_count" int null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_quote_recurrences_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_quote_recurrences_scope_idx" on "sales_quote_recurrences" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_quote_recurrences" add constraint "sales_quote_recurrences_quote_unique" unique ("quote_id");`);
    this.addSql(`alter table "sales_quote_recurrences" add constraint "sales_quote_recurrences_quote_id_foreign" foreign key ("quote_id") references "sales_quotes" ("id") on update cascade on delete cascade;`);

    this.addSql(`create table "sales_order_recurrences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_id" uuid not null, "frequency" text not null, "starts_on" date not null, "anchor_day" int null, "period_count" int null, "ends_on" date null, "next_period_index" int not null default 0, "next_invoice_on" date not null, "status" text not null default 'scheduled', "schedule_version" int not null default 1, "cancel_requested_at" timestamptz null, "cancel_effective_on" date null, "cancel_settlement" text null, "cancelled_by_user_id" uuid null, "cancel_idempotency_key" text null, "cancel_result" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_order_recurrences_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_order_recurrences_org_status_idx" on "sales_order_recurrences" ("organization_id", "status");`);
    this.addSql(`create index "sales_order_recurrences_due_idx" on "sales_order_recurrences" ("status", "next_invoice_on");`);
    this.addSql(`alter table "sales_order_recurrences" add constraint "sales_order_recurrences_order_unique" unique ("order_id");`);
    this.addSql(`alter table "sales_order_recurrences" add constraint "sales_order_recurrences_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade on delete cascade;`);

    this.addSql(`create table "sales_recurring_periods" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "order_id" uuid not null, "period_index" int not null, "period_start" date not null, "period_end" date not null, "invoice_id" uuid null, "billed_factor" numeric(5,4) not null default '1', "credit_memo_id" uuid null, "credited_factor" numeric(5,4) null, "events_emitted_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sales_recurring_periods_pkey" primary key ("id"));`);
    this.addSql(`create index "sales_recurring_periods_scope_idx" on "sales_recurring_periods" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "sales_recurring_periods" add constraint "sales_recurring_periods_order_period_unique" unique ("order_id", "period_index");`);
    this.addSql(`alter table "sales_recurring_periods" add constraint "sales_recurring_periods_order_id_foreign" foreign key ("order_id") references "sales_orders" ("id") on update cascade;`);
    this.addSql(`alter table "sales_recurring_periods" add constraint "sales_recurring_periods_invoice_id_foreign" foreign key ("invoice_id") references "sales_invoices" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "sales_recurring_periods" add constraint "sales_recurring_periods_credit_memo_id_foreign" foreign key ("credit_memo_id") references "sales_credit_memos" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "sales_recurring_periods" cascade;`);
    this.addSql(`drop table if exists "sales_order_recurrences" cascade;`);
    this.addSql(`drop table if exists "sales_quote_recurrences" cascade;`);
  }

}
