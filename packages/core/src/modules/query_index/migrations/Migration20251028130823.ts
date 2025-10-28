import { Migration } from '@mikro-orm/migrations';

export class Migration20251028130823 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "entity_index_jobs" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "organization_id" uuid null, "tenant_id" uuid null, "status" text not null, "started_at" timestamptz not null, "finished_at" timestamptz null, constraint "entity_index_jobs_pkey" primary key ("id"));`);
    this.addSql(`create index "entity_index_jobs_type_idx" on "entity_index_jobs" ("entity_type");`);
    this.addSql(`create index "entity_index_jobs_org_idx" on "entity_index_jobs" ("organization_id");`);

    this.addSql(`create table "entity_indexes" ("id" uuid not null default gen_random_uuid(), "entity_type" text not null, "entity_id" text not null, "organization_id" uuid null, "tenant_id" uuid null, "doc" jsonb not null, "embedding" jsonb null, "index_version" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, constraint "entity_indexes_pkey" primary key ("id"));`);
    this.addSql(`create index "entity_indexes_type_idx" on "entity_indexes" ("entity_type");`);
    this.addSql(`create index "entity_indexes_entity_idx" on "entity_indexes" ("entity_id");`);
    this.addSql(`create index "entity_indexes_org_idx" on "entity_indexes" ("organization_id");`);
    this.addSql(`create index "entity_indexes_customer_person_profile_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_person_profile' and organization_id is not null and tenant_id is not null;`);
    this.addSql(`create index "entity_indexes_customer_entity_doc_idx" on "entity_indexes" ("entity_id", "organization_id", "tenant_id") include ("doc") where deleted_at is null and entity_type = 'customers:customer_entity' and organization_id is not null and tenant_id is not null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "entity_index_jobs" cascade;`);

    this.addSql(`drop table if exists "entity_indexes" cascade;`);
  }

}
