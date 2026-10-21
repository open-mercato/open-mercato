import { Migration } from '@mikro-orm/migrations';

export class Migration20261019194253_saudi_localization extends Migration {

  override name = 'Migration20261019194253';

  override up(): void | Promise<void> {
    this.addSql(`create table "saudi_einvoice_submissions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid not null, "organization_id" uuid not null, "order_id" uuid not null, "invoice_number" text not null, "invoice_uuid" text not null, "icv" int not null, "invoice_hash" text not null, "previous_invoice_hash" text not null, "qr_payload" text not null, "xml" text not null, "status" text not null default 'pending', "submitted_at" timestamptz null, "cleared_at" timestamptz null, "response_json" jsonb null, "error_message" text null, "created_by" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "saudi_einvoice_submissions_icv_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "icv") where deleted_at is null;`);
    this.addSql(`create unique index "saudi_einvoice_submissions_uuid_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "invoice_uuid") where deleted_at is null;`);
    this.addSql(`create unique index "saudi_einvoice_submissions_order_unique_idx" on "saudi_einvoice_submissions" ("organization_id", "tenant_id", "order_id") where deleted_at is null;`);
    this.addSql(`create index "saudi_einvoice_submissions_order_idx" on "saudi_einvoice_submissions" ("organization_id", "order_id");`);
    this.addSql(`create index "saudi_einvoice_submissions_tenant_org_idx" on "saudi_einvoice_submissions" ("tenant_id", "organization_id");`);
    this.addSql(`alter table "saudi_einvoice_submissions" add constraint "saudi_einvoice_submissions_status_check" check ("status" in ('pending', 'submitted', 'cleared', 'rejected'));`);
  }

}
