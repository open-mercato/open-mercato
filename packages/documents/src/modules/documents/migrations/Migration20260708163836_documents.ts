import { Migration } from '@mikro-orm/migrations';

export class Migration20260708163836_documents extends Migration {

  override up(): void | Promise<void> {
    this.addSql(`create table "documents" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "title" varchar(512) not null, "folder_id" uuid null, "owner_user_id" uuid not null, "created_by_user_id" uuid not null, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "documents_owner_idx" on "documents" ("owner_user_id");`);
    this.addSql(`create index "documents_folder_idx" on "documents" ("folder_id");`);
    this.addSql(`create index "documents_scope_idx" on "documents" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_attachments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "attachment_id" uuid not null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_attachments_attachment_idx" on "document_attachments" ("attachment_id");`);
    this.addSql(`create index "document_attachments_document_idx" on "document_attachments" ("document_id");`);
    this.addSql(`create index "document_attachments_scope_idx" on "document_attachments" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_comments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "parent_comment_id" uuid null, "author_user_id" uuid not null, "body" text not null, "anchor" jsonb null, "resolved_at" timestamptz null, "resolved_by_user_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_comments_parent_idx" on "document_comments" ("parent_comment_id");`);
    this.addSql(`create index "document_comments_document_idx" on "document_comments" ("document_id");`);
    this.addSql(`create index "document_comments_scope_idx" on "document_comments" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_contents" ("id" uuid not null default gen_random_uuid(), "document_id" uuid not null, "organization_id" uuid not null, "tenant_id" uuid not null, "yjs_state" bytea null, "content_html" text null, "content_text" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_contents_scope_idx" on "document_contents" ("organization_id", "tenant_id");`);
    this.addSql(`alter table "document_contents" add constraint "document_contents_document_unique" unique ("document_id");`);

    this.addSql(`create table "document_folders" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "name" varchar(256) not null, "parent_folder_id" uuid null, "owner_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "document_folders_owner_idx" on "document_folders" ("owner_user_id");`);
    this.addSql(`create index "document_folders_parent_idx" on "document_folders" ("parent_folder_id");`);
    this.addSql(`create index "document_folders_scope_idx" on "document_folders" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_shares" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "principal_type" varchar(16) not null, "principal_id" uuid not null, "permission" varchar(16) not null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "document_shares_active_principal_unique" on "document_shares" ("document_id", "principal_type", "principal_id") where "deleted_at" is null;`);
    this.addSql(`create index "document_shares_document_idx" on "document_shares" ("document_id");`);
    this.addSql(`create index "document_shares_scope_idx" on "document_shares" ("organization_id", "tenant_id", "deleted_at");`);

    this.addSql(`create table "document_versions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "document_id" uuid not null, "label" varchar(256) null, "yjs_snapshot" bytea not null, "content_html" text null, "created_by_user_id" uuid not null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "document_versions_document_idx" on "document_versions" ("document_id", "created_at");`);
    this.addSql(`create index "document_versions_scope_idx" on "document_versions" ("organization_id", "tenant_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "document_versions" cascade;`);
    this.addSql(`drop table if exists "document_shares" cascade;`);
    this.addSql(`drop table if exists "document_folders" cascade;`);
    this.addSql(`drop table if exists "document_contents" cascade;`);
    this.addSql(`drop table if exists "document_comments" cascade;`);
    this.addSql(`drop table if exists "document_attachments" cascade;`);
    this.addSql(`drop table if exists "documents" cascade;`);
  }

}
