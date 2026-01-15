import { Migration } from '@mikro-orm/migrations'

export class Migration20260115000001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "fms_documents" (
        "id" uuid not null default gen_random_uuid(),
        "organization_id" uuid not null,
        "tenant_id" uuid not null,
        "name" text not null,
        "category" text null,
        "description" text null,
        "attachment_id" uuid not null,
        "related_entity_id" uuid null,
        "related_entity_type" text null,
        "extracted_data" jsonb null,
        "processed_at" timestamptz null,
        "created_at" timestamptz not null,
        "created_by" uuid null,
        "updated_at" timestamptz not null,
        "updated_by" uuid null,
        "deleted_at" timestamptz null,
        constraint "fms_documents_pkey" primary key ("id")
      );
    `)

    this.addSql(
      `create index "fms_documents_scope_idx" on "fms_documents" ("organization_id", "tenant_id");`
    )
    this.addSql(`create index "fms_documents_category_idx" on "fms_documents" ("category");`)
    this.addSql(`create index "fms_documents_attachment_idx" on "fms_documents" ("attachment_id");`)
    this.addSql(
      `create index "fms_documents_related_entity_idx" on "fms_documents" ("related_entity_id", "related_entity_type");`
    )

    this.addSql(`
      alter table "fms_documents"
      add constraint "fms_documents_attachment_id_foreign"
      foreign key ("attachment_id")
      references "attachments" ("id")
      on update cascade
      on delete restrict;
    `)
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "fms_documents" cascade;`)
  }
}
