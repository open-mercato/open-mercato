import { Migration } from '@mikro-orm/migrations';

export class Migration20260809121904_document_generators extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "document_generators_generated_documents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "resource_kind" text not null, "resource_id" text not null, "resource_label" text not null, "template_id" text not null, "template_label" text not null, "format" text not null default 'pdf', "mime_type" text not null default 'application/pdf', "generated_by" uuid not null, "generated_at" timestamptz not null, "attachment_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "document_generators_generated_documents_resource_idx" on "document_generators_generated_documents" ("organization_id", "resource_kind", "resource_id");`);
    this.addSql(`create index "document_generators_generated_documents_org_idx" on "document_generators_generated_documents" ("organization_id");`);
  }

}
