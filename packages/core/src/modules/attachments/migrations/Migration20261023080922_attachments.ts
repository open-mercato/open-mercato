import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';
import { defaultEncryptionMaps } from '../encryption';

export class Migration20261023080922_attachments extends Migration {

  override name = 'Migration20261023080922';

  override up(): void | Promise<void> {
    this.addSql(`create table "attachment_document_extractions" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "attachment_id" uuid not null, "partition_code" text not null, "content_sha256" varchar(64) not null, "engine" varchar(32) not null, "engine_version" int not null, "status" varchar(20) not null default 'pending', "skip_reason" varchar(40) null, "page_count" int null, "section_count" int null, "char_count" int null, "ocr_page_count" int null, "normalized_text" text null, "failure_reason" text null, "stats" jsonb null, "requested_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "completed_at" timestamptz null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "attachment_document_extractions_live_unique" on "attachment_document_extractions" ("attachment_id", "content_sha256", "engine_version") where deleted_at is null;`);
    this.addSql(`create index "attachment_document_extractions_attachment_idx" on "attachment_document_extractions" ("attachment_id", "created_at");`);
    this.addSql(`create index "attachment_document_extractions_scope_idx" on "attachment_document_extractions" ("tenant_id", "organization_id");`);

    this.addSql(`create table "attachment_document_sections" ("id" uuid not null default gen_random_uuid(), "tenant_id" uuid null, "organization_id" uuid null, "extraction_id" uuid not null, "attachment_id" uuid not null, "parent_id" uuid null, "ordinal" int not null, "depth" smallint not null, "kind" varchar(20) not null, "number_label" varchar(64) null, "heading" text null, "heading_path" jsonb not null, "text" text not null, "page_start" int null, "page_end" int null, "char_start" int not null, "char_end" int not null, "anchor_key" varchar(32) not null, "text_sha256" varchar(64) not null, "token_estimate" int not null, "source" varchar(16) not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "attachment_document_sections_scope_idx" on "attachment_document_sections" ("tenant_id", "organization_id");`);
    this.addSql(`create index "attachment_document_sections_anchor_key_idx" on "attachment_document_sections" ("attachment_id", "anchor_key");`);
    this.addSql(`create index "attachment_document_sections_number_label_idx" on "attachment_document_sections" ("attachment_id", "number_label");`);
    this.addSql(`create index "attachment_document_sections_extraction_ordinal_idx" on "attachment_document_sections" ("extraction_id", "ordinal");`);

    this.addSql(`alter table "attachment_partitions" add "extract_document_structure" boolean not null default false, add "index_document_sections" boolean not null default false;`);

    for (const map of defaultEncryptionMaps) {
      this.addSql(buildEncryptionMapBackfillSql(map));
    }
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "attachment_partitions" drop column "extract_document_structure", drop column "index_document_sections";`);
    this.addSql(`drop table if exists "attachment_document_sections" cascade;`);
    this.addSql(`drop table if exists "attachment_document_extractions" cascade;`);
  }

}
