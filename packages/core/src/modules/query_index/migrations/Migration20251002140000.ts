import { Migration } from '@mikro-orm/migrations'

export class Migration20251002140000 extends Migration {
  override async up(): Promise<void> {
    // embedding column on entity_indexes (if missing)
    this.addSql(`do $$ begin
if not exists (
  select 1 from information_schema.columns where table_name = 'entity_indexes' and column_name = 'embedding'
) then
  alter table "entity_indexes" add column "embedding" jsonb null;
end if;
end $$;`)

    // entity_index_jobs table
    this.addSql(`create table if not exists "entity_index_jobs" (
  "id" uuid not null default gen_random_uuid(),
  "entity_type" text not null,
  "organization_id" uuid null,
  "tenant_id" uuid null,
  "status" text not null,
  "started_at" timestamptz not null default now(),
  "finished_at" timestamptz null,
  constraint "entity_index_jobs_pkey" primary key ("id")
)`)
    this.addSql(`create index if not exists "entity_index_jobs_type_idx" on "entity_index_jobs" ("entity_type")`)
    this.addSql(`create index if not exists "entity_index_jobs_org_idx" on "entity_index_jobs" ("organization_id")`)
  }

  override async down(): Promise<void> {
    // Revert jobs table (non-destructive optional)
    this.addSql('drop table if exists "entity_index_jobs" cascade;')
    // embedding column left in place as it's additive; safe to keep
  }
}
