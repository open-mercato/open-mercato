import { Migration } from '@mikro-orm/migrations';

export class Migration20260709164720_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "document_templates" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" varchar(256) not null, "description" text null, "body_html" text not null, "context_slots" jsonb null, "created_by_user_id" uuid not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_templates_scope_idx" on "document_templates" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`alter table "document_comments" add "mentions" jsonb null;`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "document_comments" drop column "mentions";`);

    this.addSql(`drop index if exists "document_templates_scope_idx";`);
    this.addSql(`drop table if exists "document_templates" cascade;`);
  }

}
