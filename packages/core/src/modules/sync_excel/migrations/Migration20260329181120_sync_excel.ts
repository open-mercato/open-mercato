import { Migration } from '@mikro-orm/migrations';

export class Migration20260329181120_sync_excel extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "sync_excel_uploads" ("id" uuid not null default gen_random_uuid(), "attachment_id" uuid not null, "filename" text not null, "mime_type" text not null, "file_size" int not null, "entity_type" text not null, "delimiter" text null, "encoding" text null, "headers" jsonb not null, "sample_rows" jsonb not null, "total_rows" int not null, "status" text not null default 'uploaded', "sync_run_id" uuid null, "organization_id" uuid not null, "tenant_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, constraint "sync_excel_uploads_pkey" primary key ("id"));`);
    this.addSql(`create index "sync_excel_uploads_organization_id_tenant_id_status_index" on "sync_excel_uploads" ("organization_id", "tenant_id", "status");`);
  }

}
