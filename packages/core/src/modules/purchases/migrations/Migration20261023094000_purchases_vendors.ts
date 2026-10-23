import { Migration } from '@mikro-orm/migrations';

export class Migration20261023094000_purchases_vendors extends Migration {

  override name = 'Migration20261023094000';

  override up(): void | Promise<void> {
    this.addSql(`create table if not exists "purchases_vendors" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "metadata" jsonb null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, "name" text not null, "code" text null, "email" text null, "phone" text null, "currency_code" text not null default 'PLN', "payment_terms" text null, "tax_id" text null, "address" text null, "notes" text null, "is_active" boolean not null default true, primary key ("id"));`);
    this.addSql(`create index if not exists "purchases_vendors_scope_idx" on "purchases_vendors" ("organization_id", "tenant_id");`);
    this.addSql(`create index if not exists "purchases_vendors_code_idx" on "purchases_vendors" ("code");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "purchases_vendors" cascade;`);
  }

}
