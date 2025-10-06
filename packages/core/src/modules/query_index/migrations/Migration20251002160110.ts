import { Migration } from '@mikro-orm/migrations';

export class Migration20251002160110 extends Migration {

  override async up(): Promise<void> {
    // Make creation idempotent to avoid conflicts when earlier migrations created these
    this.addSql(`create table if not exists "entity_index_jobs" (
  "id" uuid not null default gen_random_uuid(),
  "entity_type" text not null,
  "organization_id" uuid null,
  "tenant_id" uuid null,
  "status" text not null,
  "started_at" timestamptz not null,
  "finished_at" timestamptz null,
  constraint "entity_index_jobs_pkey" primary key ("id")
);`);
    this.addSql(`create index if not exists "entity_index_jobs_type_idx" on "entity_index_jobs" ("entity_type");`);
    this.addSql(`create index if not exists "entity_index_jobs_org_idx" on "entity_index_jobs" ("organization_id");`);

    this.addSql(`alter table "entity_indexes" add column if not exists "embedding" jsonb null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "entity_index_jobs" cascade;`);

    this.addSql(`alter table "entity_indexes" drop column if exists "embedding";`);
  }

}
